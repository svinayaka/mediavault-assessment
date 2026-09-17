import { useEffect, useState, useRef, useCallback } from 'react';
import { listAssets } from '@/api/client';
import type { Asset, AssetPage, AssetQuery } from '@/lib/types';

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
      // inFlightRef represents whether this specific execution finished, unconditionally
      inFlightRef.current = false;
      if (myGen === generationRef.current) {
        loadMoreAbortRef.current = null;
      }
    }
  }, []); // Stable callback identity that never needs to rebind scroll listeners

  return {
    items: state.items,
    total: state.total,
    // Note: `hasMore` derives from rendered state for UI consistency, while `cursorContextRef` gates fetch executions.
    hasMore: state.nextCursor !== null,
    loading: state.loading,
    loadingMore: state.loadingMore,
    error: state.error,
    loadMoreError: state.loadMoreError,
    loadMore,
  };
}
