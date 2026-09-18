import type {
  Asset,
  AssetPage,
  AssetQuery,
  BulkResult,
  AssetStatus,
  BulkExecutionResult,
  BulkItemFailure,
} from '@/lib/types';

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly retryAfterMs?: number;

  constructor(message: string, status: number, code?: string, retryAfterMs?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

const inFlight = new Map<string, Promise<unknown>>();

function requestKey(path: string, init?: RequestInit): string | null {
  const method = (init?.method ?? 'GET').toUpperCase();
  if (method !== 'GET') return null; // Only dedupe idempotent GET requests
  return `${method} ${path}`;
}

function dedupe<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const promise = fn().finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
}

function toSearchParams(query: AssetQuery): string {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.status?.length) params.set('status', query.status.join(','));
  if (query.kind?.length) params.set('kind', query.kind.join(','));
  if (query.tag?.length) params.set('tag', query.tag.join(','));
  if (query.collectionId) params.set('collectionId', query.collectionId);
  if (query.owner) params.set('owner', query.owner);
  if (query.sort) params.set('sort', query.sort);
  if (query.limit) params.set('limit', String(query.limit));
  if (query.cursor) params.set('cursor', query.cursor);
  return params.toString();
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const performFetch = async () => {
    const res = await fetch(path, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });
    if (!res.ok) {
      let detail = res.statusText;
      let code: string | undefined;
      try {
        const body = await res.json();
        detail = body?.error?.message ?? body?.message ?? detail;
        code = body?.error?.code ?? body?.code;
      } catch {
        /* response was not JSON */
      }
      const retryAfterHeader = res.headers.get('retry-after');
      const retryAfterMs = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) * 1000 : undefined;
      throw new ApiError(detail, res.status, code, retryAfterMs);
    }
    return res.json() as Promise<T>;
  };

  const key = requestKey(path, init);
  if (key && !init?.signal) {
    return dedupe(key, performFetch);
  }
  return performFetch();
}

export function listAssets(query: AssetQuery, signal?: AbortSignal): Promise<AssetPage> {
  return request<AssetPage>(`/api/assets?${toSearchParams(query)}`, {
    signal,
  });
}

export function getAsset(id: string): Promise<Asset> {
  return request<Asset>(`/api/assets/${id}`);
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const currentIndex = index++;
      results[currentIndex] = await fn(items[currentIndex]!);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function getAssetsByIds(ids: string[]): Promise<{ items: Asset[]; missing: string[] }> {
  if (ids.length === 0) return { items: [], missing: [] };
  const chunks = chunk(ids, 25);
  const chunkResults = await mapConcurrent(chunks, 3, (batchIds) =>
    request<{ items: Asset[]; missing: string[] }>(`/api/assets/batch?ids=${batchIds.join(',')}`),
  );

  const items: Asset[] = [];
  const missing: string[] = [];
  for (const res of chunkResults) {
    items.push(...res.items);
    missing.push(...res.missing);
  }
  return { items, missing };
}

export function updateAsset(
  id: string,
  version: number,
  patch: Partial<Pick<Asset, 'name' | 'status' | 'tags'>>,
): Promise<Asset> {
  return request<Asset>(`/api/assets/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ version, patch }),
  });
}

export async function bulkSetStatus(
  ids: string[],
  status: AssetStatus,
): Promise<BulkExecutionResult> {
  if (ids.length === 0) {
    return { succeeded: [], failed: [], unknown: [], appliedAssets: [] };
  }

  const chunks = chunk(ids, 50);
  const chunkResults = await mapConcurrent(chunks, 3, async (batchIds) => {
    try {
      const res = await request<BulkResult>('/api/assets/bulk-status', {
        method: 'POST',
        body: JSON.stringify({ ids: batchIds, status }),
      });
      return { ok: true as const, res, batchIds };
    } catch {
      return { ok: false as const, batchIds };
    }
  });

  const succeeded: string[] = [];
  const failed: BulkItemFailure[] = [];
  const unknown: string[] = [];
  const appliedAssets: Asset[] = [];

  for (const chunkRes of chunkResults) {
    if (!chunkRes.ok) {
      unknown.push(...chunkRes.batchIds);
      continue;
    }

    for (const r of chunkRes.res.results) {
      if (r.ok) {
        succeeded.push(r.id);
        appliedAssets.push(r.asset);
      } else {
        const retryable = r.code !== 'legal_hold' && r.code !== 'not_found';
        failed.push({
          id: r.id,
          code: r.code,
          message: r.message,
          retryable,
        });
      }
    }
  }

  return { succeeded, failed, unknown, appliedAssets };
}

export const thumbnailUrl = (id: string) => `/api/thumb/${id}.svg`;
