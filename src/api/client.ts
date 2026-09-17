import type { Asset, AssetPage, AssetQuery, BulkResult } from '@/lib/types';

/**
 * Baseline client. It works on a good network and falls apart on a bad one.
 *
 * Known gaps, all of which are yours to close:
 *   - no request cancellation
 *   - no retry, no backoff, no handling of Retry-After
 *   - no de-duplication of concurrent identical requests
 *   - error information is flattened into a string
 *   - callers cannot distinguish "retry this" from "do not retry this"
 */

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
  const callerSignal = init?.signal;
  const { signal: _, ...fetchInit } = init ?? {};

  const performFetch = async () => {
    const res = await fetch(path, {
      ...fetchInit,
      headers: { 'content-type': 'application/json', ...(fetchInit.headers ?? {}) },
    });
    if (!res.ok) {
      let detail = res.statusText;
      try {
        const body = await res.json();
        detail = body?.error?.message ?? detail;
      } catch {
        /* response was not JSON */
      }
      throw new Error(`${res.status}: ${detail}`);
    }
    return res.json() as Promise<T>;
  };

  const key = requestKey(path, init);
  const promise = key ? dedupe(key, performFetch) : performFetch();

  if (!callerSignal) {
    return promise;
  }

  return new Promise<T>((resolve, reject) => {
    if (callerSignal.aborted) {
      return reject(new DOMException('Aborted', 'AbortError'));
    }
    const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
    callerSignal.addEventListener('abort', onAbort, { once: true });
    promise
      .then((val) => {
        callerSignal.removeEventListener('abort', onAbort);
        resolve(val);
      })
      .catch((err) => {
        callerSignal.removeEventListener('abort', onAbort);
        reject(err);
      });
  });
}

export function listAssets(query: AssetQuery, signal?: AbortSignal): Promise<AssetPage> {
  return request<AssetPage>(`/api/assets?${toSearchParams(query)}`, {
    signal
  });
}

export function getAsset(id: string): Promise<Asset> {
  return request<Asset>(`/api/assets/${id}`);
}

export function getAssetsByIds(ids: string[]): Promise<{ items: Asset[]; missing: string[] }> {
  // Note: the endpoint rejects more than 25 ids per call.
  return request(`/api/assets/batch?ids=${ids.join(',')}`);
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

export function bulkSetStatus(ids: string[], status: Asset['status']): Promise<BulkResult> {
  // Note: the endpoint rejects more than 50 ids per call.
  return request<BulkResult>('/api/assets/bulk-status', {
    method: 'POST',
    body: JSON.stringify({ ids, status }),
  });
}

export const thumbnailUrl = (id: string) => `/api/thumb/${id}.svg`;
