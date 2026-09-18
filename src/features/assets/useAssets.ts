import { useEffect, useState, useRef, useCallback } from 'react';
import { listAssets, bulkSetStatus } from '@/api/client';
import type {
  Asset,
  AssetPage,
  AssetQuery,
  AssetStatus,
  BulkExecutionResult,
} from '@/lib/types';

interface State {
  items: Asset[];
  total: number;
  nextCursor: string | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  loadMoreError: string | null;
}

export function useAssets(query: AssetQuery) {
  const [state, setState] = useState<State>({
    items: [],
    total: 0,
    nextCursor: null,
    loading: true,
    loadingMore: false,
    error: null,
    loadMoreError: null,
  });

  const generationRef = useRef(0);
  const inFlightRef = useRef(false);
  const initialLoadingRef = useRef(true);

  const itemsRef = useRef<Asset[]>(state.items);
  itemsRef.current = state.items;

  /**
   * Cursors are strictly bound to the exact query that produced them (API contract: API.md).
   * By coupling `cursor` and `query` into a single atomic ref, we guarantee that `loadMore`
   * can never pair a cursor from an earlier query with filters from a newer query—even if
   * React renders a new query before its effect runs.
   */
  const cursorContextRef = useRef<{ cursor: string; query: AssetQuery } | null>(null);
  const loadMoreAbortRef = useRef<AbortController | null>(null);

  // Initial / Filter-change query effect
  useEffect(() => {
    // 1. Increment generation counter to synchronously invalidate all prior in-flight requests
    const myGen = ++generationRef.current;
    const controller = new AbortController();

    // 2. Abort any running loadMore request from the previous query
    loadMoreAbortRef.current?.abort();
    loadMoreAbortRef.current = null;
    inFlightRef.current = false;
    initialLoadingRef.current = true;
    cursorContextRef.current = null;

    // 3. Reset state immediately on query change to avoid stale cursor reuse
    setState({
      items: [],
      total: 0,
      nextCursor: null,
      loading: true,
      loadingMore: false,
      error: null,
      loadMoreError: null,
    });

    listAssets(query, controller.signal)
      .then((page: AssetPage) => {
        if (myGen !== generationRef.current) return;
        initialLoadingRef.current = false;
        cursorContextRef.current = page.nextCursor ? { cursor: page.nextCursor, query } : null;
        setState({
          items: page.items,
          total: page.total,
          nextCursor: page.nextCursor,
          loading: false,
          loadingMore: false,
          error: null,
          loadMoreError: null,
        });
      })
      .catch((err: unknown) => {
        if (myGen !== generationRef.current) return;
        if (controller.signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
          return;
        }
        initialLoadingRef.current = false;
        setState((s) => ({
          ...s,
          loading: false,
          loadingMore: false,
          error: err instanceof Error ? err.message : 'Failed to load assets',
        }));
      });

    return () => {
      controller.abort();
    };
  }, [
    query.q,
    query.sort,
    query.limit,
    query.collectionId,
    query.owner,
    query.status?.join(','),
    query.kind?.join(','),
    query.tag?.join(','),
  ]);

  // Load next page
  const loadMore = useCallback(async () => {
    const cursorContext = cursorContextRef.current;
    // Guard against: no cursor/query pair, already fetching, or initial query load in-flight
    if (!cursorContext || inFlightRef.current || initialLoadingRef.current) {
      return;
    }

    inFlightRef.current = true;
    const myGen = generationRef.current;
    const controller = new AbortController();
    loadMoreAbortRef.current = controller;

    setState((s) => ({ ...s, loadingMore: true, loadMoreError: null }));

    try {
      const page = await listAssets(
        { ...cursorContext.query, cursor: cursorContext.cursor },
        controller.signal,
      );
      if (myGen !== generationRef.current) return;

      cursorContextRef.current = page.nextCursor
        ? { cursor: page.nextCursor, query: cursorContext.query }
        : null;
      setState((s) => ({
        ...s,
        items: [...s.items, ...page.items],
        total: page.total,
        nextCursor: page.nextCursor,
        loadingMore: false,
        loadMoreError: null,
      }));
    } catch (err: unknown) {
      if (myGen !== generationRef.current) return;
      if (controller.signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
        return;
      }
      setState((s) => ({
        ...s,
        loadingMore: false,
        loadMoreError: err instanceof Error ? err.message : 'Failed to load more assets',
      }));
    } finally {
      inFlightRef.current = false;
      if (myGen === generationRef.current) {
        loadMoreAbortRef.current = null;
      }
    }
  }, []);

  const updateAssetItem = useCallback((updated: Asset) => {
    setState((prev) => ({
      ...prev,
      items: prev.items.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)),
    }));
  }, []);

  const applyBulkStatus = useCallback(
    async (ids: string[], next: AssetStatus): Promise<BulkExecutionResult> => {
      if (ids.length === 0) {
        return { succeeded: [], failed: [], unknown: [], appliedAssets: [] };
      }

      const myGen = generationRef.current;

      // 1. Snapshot previous status of target items
      const targetIds = new Set(ids);
      const snapshot = new Map<string, AssetStatus>();
      for (const item of itemsRef.current) {
        if (targetIds.has(item.id)) {
          snapshot.set(item.id, item.status);
        }
      }

      // 2. Apply optimistic local update
      setState((prev) => ({
        ...prev,
        items: prev.items.map((item) =>
          targetIds.has(item.id) ? { ...item, status: next } : item,
        ),
      }));

      // 3. Delegate execution to chunked client helper
      const result = await bulkSetStatus(ids, next);

      // 4. Guard against race with query/filter changes
      if (myGen !== generationRef.current) return result;

      // 5. Rollback failed and unknown items; reconcile version/metadata of succeeded items
      const rollbackMap = new Map<string, AssetStatus>();
      for (const f of result.failed) {
        const orig = snapshot.get(f.id);
        if (orig !== undefined) rollbackMap.set(f.id, orig);
      }
      for (const u of result.unknown) {
        const orig = snapshot.get(u);
        if (orig !== undefined) rollbackMap.set(u, orig);
      }

      const appliedMap = new Map<string, Asset>(result.appliedAssets.map((a) => [a.id, a]));

      setState((prev) => ({
        ...prev,
        items: prev.items.map((item) => {
          const rollbackStatus = rollbackMap.get(item.id);
          if (rollbackStatus !== undefined) {
            return { ...item, status: rollbackStatus };
          }
          const applied = appliedMap.get(item.id);
          if (applied) {
            return applied;
          }
          return item;
        }),
      }));

      return result;
    },
    [],
  );

  return {
    items: state.items,
    total: state.total,
    hasMore: state.nextCursor !== null,
    loading: state.loading,
    loadingMore: state.loadingMore,
    error: state.error,
    loadMoreError: state.loadMoreError,
    loadMore,
    applyBulkStatus,
    updateAssetItem,
  };
}
