import { useState, useEffect, useCallback, useRef } from 'react';
import { AssetDetail } from '@/features/assets/AssetDetail';
import { AssetGrid } from '@/features/assets/AssetGrid';
import { useAssets } from '@/features/assets/useAssets';
import { OfflineBanner } from '@/components/OfflineBanner';
import { PanelBoundary } from '@/components/PanelBoundary';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { statusLabel } from '@/lib/format';
import type { Asset, AssetStatus, AssetKind, AssetQuery } from '@/lib/types';

const STATUSES: AssetStatus[] = ['draft', 'in_review', 'approved', 'archived'];
const KINDS: AssetKind[] = ['image', 'video', 'document'];
const SORTS: Array<{ value: NonNullable<AssetQuery['sort']>; label: string }> = [
  { value: 'updatedAt:desc', label: 'Recently updated' },
  { value: 'name:asc', label: 'Name A–Z' },
  { value: 'sizeBytes:desc', label: 'Largest first' },
  { value: 'createdAt:desc', label: 'Newest' },
];

function formatIdList(ids: string[]): string {
  if (ids.length === 0) return '';
  if (ids.length <= 2) return ` (${ids.join(', ')})`;
  return ` (${ids.slice(0, 2).join(', ')}, +${ids.length - 2} more)`;
}

function getInitialParams() {
  const params = new URLSearchParams(window.location.search);
  const q = params.get('q') ?? '';
  const status = (params.get('status')?.split(',').filter(Boolean) as AssetStatus[]) ?? [];
  const kind = (params.get('kind')?.split(',').filter(Boolean) as AssetKind[]) ?? [];
  const tag = params.get('tag')?.split(',').filter(Boolean) ?? [];
  const sort = (params.get('sort') as NonNullable<AssetQuery['sort']>) ?? 'updatedAt:desc';
  return { q, status, kind, tag, sort };
}

function computeRangeSelection(
  items: Asset[],
  startId: string,
  endId: string,
  prevSelection: Set<string>,
): Set<string> | null {
  const startIndex = items.findIndex((a) => a.id === startId);
  const endIndex = items.findIndex((a) => a.id === endId);

  if (startIndex === -1 || endIndex === -1) {
    return null;
  }

  const next = new Set(prevSelection);
  const [min, max] = startIndex < endIndex ? [startIndex, endIndex] : [endIndex, startIndex];
  for (let i = min; i <= max; i++) {
    const item = items[i];
    if (item) {
      next.add(item.id);
    }
  }
  return next;
}

export function App() {
  const initial = getInitialParams();
  const [q, setQ] = useState(initial.q);
  const [debouncedQ, setDebouncedQ] = useState(initial.q);
  const [status, setStatus] = useState<AssetStatus[]>(initial.status);
  const [kind, setKind] = useState<AssetKind[]>(initial.kind);
  const [tag] = useState<string[]>(initial.tag);
  const [sort, setSort] = useState<NonNullable<AssetQuery['sort']>>(initial.sort);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set<string>());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [retryTarget, setRetryTarget] = useState<{
    ids: string[];
    status: AssetStatus;
  } | null>(null);
  const [isApplyingBulk, setIsApplyingBulk] = useState(false);
  const [isSavingDetail, setIsSavingDetail] = useState(false);

  const isApplyingBulkRef = useRef(false);

  const { isOnline } = useOnlineStatus();
  const wasOnlineRef = useRef(isOnline);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQ(q);
    }, 300);
    return () => clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (debouncedQ) params.set('q', debouncedQ);
    if (status.length > 0) params.set('status', status.join(','));
    if (kind.length > 0) params.set('kind', kind.join(','));
    if (tag.length > 0) params.set('tag', tag.join(','));
    if (sort !== 'updatedAt:desc') params.set('sort', sort);
    const qs = params.toString();
    const newUrl = qs ? `?${qs}` : window.location.pathname;
    window.history.replaceState(null, '', newUrl);
  }, [debouncedQ, sort, status, kind, tag]);

  const {
    items,
    total,
    loading,
    loadingMore,
    error,
    loadMoreError,
    hasMore,
    refetch,
    loadMore,
    applyBulkStatus,
    updateAssetItem,
  } = useAssets({
    q: debouncedQ,
    status,
    kind,
    tag,
    sort,
    limit: 24,
  });

  const pendingReconnectRefetchRef = useRef(false);

  // Guarded & deferred offline recovery refetch
  // When coming back online, sets pending flag; refetches as soon as all in-flight mutations and loads finish
  useEffect(() => {
    if (!wasOnlineRef.current && isOnline) {
      pendingReconnectRefetchRef.current = true;
    }
    wasOnlineRef.current = isOnline;

    if (pendingReconnectRefetchRef.current && isOnline) {
      const canSafelyRefetch =
        !isApplyingBulk &&
        !isSavingDetail &&
        !loading &&
        !loadingMore;

      if (canSafelyRefetch) {
        pendingReconnectRefetchRef.current = false;
        refetch();
      }
    }
  }, [isOnline, isApplyingBulk, isSavingDetail, loading, loadingMore, refetch]);

  const itemsRef = useRef<Asset[]>(items);
  itemsRef.current = items;

  const selectedIdsRef = useRef<Set<string>>(selectedIds);
  selectedIdsRef.current = selectedIds;

  const lastSelectedIdRef = useRef<string | null>(null);

  // Clear selection, anchor, and prior notices on search/filter changes (preserves across sort)
  useEffect(() => {
    setSelectedIds(new Set<string>());
    lastSelectedIdRef.current = null;
    setNotice(null);
    setRetryTarget(null);
  }, [debouncedQ, status, kind, tag]);

  const toggleSelect = useCallback((id: string, isShift?: boolean) => {
    const lastId = lastSelectedIdRef.current;
    const prev = selectedIdsRef.current;

    let next: Set<string> | null = null;
    if (isShift && lastId) {
      next = computeRangeSelection(itemsRef.current, lastId, id, prev);
    }

    if (!next) {
      next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
    }

    lastSelectedIdRef.current = id;
    selectedIdsRef.current = next;
    setSelectedIds(next);
  }, []);

  const selectAllLoaded = useCallback(() => {
    const allIds = new Set<string>(itemsRef.current.map((a: Asset) => a.id));
    selectedIdsRef.current = allIds;
    setSelectedIds(allIds);
  }, []);

  const clearSelection = useCallback(() => {
    const empty = new Set<string>();
    selectedIdsRef.current = empty;
    lastSelectedIdRef.current = null;
    setSelectedIds(empty);
  }, []);

  async function applyBulkStatusHandler(next: AssetStatus, explicitIds?: string[]) {
    if (isApplyingBulkRef.current) return;
    const ids = explicitIds ?? [...selectedIdsRef.current];
    if (ids.length === 0) return;

    isApplyingBulkRef.current = true;
    setIsApplyingBulk(true);
    setNotice(null);
    setRetryTarget(null);

    try {
      const result = await applyBulkStatus(ids, next);

      // Deselect succeeded IDs; keep failed & unknown selected for retry
      setSelectedIds((prev) => {
        const nextSet = new Set(prev);
        result.succeeded.forEach((id) => nextSet.delete(id));
        selectedIdsRef.current = nextSet;
        return nextSet;
      });

      // Retain retryable IDs
      const retryableIds = [
        ...result.failed.filter((f) => f.retryable).map((f) => f.id),
        ...result.unknown,
      ];

      if (retryableIds.length > 0) {
        setRetryTarget({ ids: retryableIds, status: next });
      }

      // Build human-readable notice breakdown with failed IDs
      const legalHoldItems = result.failed.filter((f) => f.code === 'legal_hold');
      const notFoundItems = result.failed.filter((f) => f.code === 'not_found');
      const conflictItems = result.failed.filter((f) => f.code === 'conflict');
      const otherItems = result.failed.filter(
        (f) => f.code !== 'legal_hold' && f.code !== 'not_found' && f.code !== 'conflict',
      );

      const parts: string[] = [];
      if (result.succeeded.length > 0) {
        parts.push(`${result.succeeded.length} updated`);
      }
      if (legalHoldItems.length > 0) {
        parts.push(`${legalHoldItems.length} blocked by legal hold${formatIdList(legalHoldItems.map((i) => i.id))}`);
      }
      if (notFoundItems.length > 0) {
        parts.push(`${notFoundItems.length} not found${formatIdList(notFoundItems.map((i) => i.id))}`);
      }
      if (conflictItems.length > 0) {
        parts.push(`${conflictItems.length} write conflict${formatIdList(conflictItems.map((i) => i.id))}`);
      }
      if (otherItems.length > 0) {
        parts.push(`${otherItems.length} failed${formatIdList(otherItems.map((i) => i.id))}`);
      }
      if (result.unknown.length > 0) {
        parts.push(`${result.unknown.length} unconfirmed due to network error`);
      }

      setNotice(parts.join(' · '));
    } finally {
      isApplyingBulkRef.current = false;
      setIsApplyingBulk(false);
    }
  }

  const gridResetKey = `${debouncedQ}:${sort}:${status.join(',')}:${kind.join(',')}:${tag.join(',')}`;

  return (
    <div className="app">
      {/* Root-level offline banner outside all panel error boundaries */}
      <OfflineBanner />

      <header className="topbar">
        <h1>MediaVault</h1>
        <input
          className="search"
          type="search"
          placeholder="Search assets"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
          {SORTS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </header>

      <div className="filters">
        {STATUSES.map((s) => (
          <label key={s}>
            <input
              type="checkbox"
              checked={status.includes(s)}
              onChange={(e) =>
                setStatus((prev) =>
                  e.target.checked ? [...prev, s] : prev.filter((x) => x !== s),
                )
              }
            />
            {statusLabel(s)}
          </label>
        ))}
        {KINDS.map((k) => (
          <label key={k}>
            <input
              type="checkbox"
              checked={kind.includes(k)}
              onChange={(e) =>
                setKind((prev) =>
                  e.target.checked ? [...prev, k] : prev.filter((x) => x !== k),
                )
              }
            />
            {k.charAt(0).toUpperCase() + k.slice(1)}
          </label>
        ))}
        <span className="muted">
          {loading ? 'Loading…' : `${items.length} of ${total.toLocaleString()} shown`}
        </span>
      </div>

      {/* Bulk action toolbar */}
      {selectedIds.size > 0 && (
        <div className="bulkbar" role="toolbar" aria-label="Bulk actions">
          <span className="bulkbar__count">
            {selectedIds.size} of {items.length} loaded selected
          </span>
          {selectedIds.size < items.length && (
            <button type="button" disabled={isApplyingBulk} onClick={selectAllLoaded}>
              Select all {items.length} loaded
            </button>
          )}
          {STATUSES.map((s) => (
            <button
              type="button"
              key={s}
              disabled={isApplyingBulk}
              onClick={() => applyBulkStatusHandler(s)}
            >
              {isApplyingBulk ? 'Updating…' : `Set ${statusLabel(s).toLowerCase()}`}
            </button>
          ))}
          <button type="button" disabled={isApplyingBulk} onClick={clearSelection}>
            Clear selection
          </button>
        </div>
      )}

      {/* Notice with Retry Button */}
      {notice && (
        <div className="notice-banner">
          <p className="notice">{notice}</p>
          {retryTarget && (
            <button
              type="button"
              className="notice__btn"
              disabled={isApplyingBulk}
              onClick={() => applyBulkStatusHandler(retryTarget.status, retryTarget.ids)}
            >
              Retry {retryTarget.ids.length} items
            </button>
          )}
        </div>
      )}

      <main className="content">
        <PanelBoundary
          name="Asset Grid"
          resetKey={gridResetKey}
          onRetry={refetch}
        >
          <AssetGrid
            assets={items}
            loading={loading}
            loadingMore={loadingMore}
            error={error}
            loadMoreError={loadMoreError}
            hasMore={hasMore}
            selectedIds={selectedIds}
            activeId={activeId}
            onToggleSelect={toggleSelect}
            onOpen={setActiveId}
            onLoadMore={loadMore}
          />
        </PanelBoundary>

        {activeId && (
          <PanelBoundary
            name="Asset Detail"
            resetKey={activeId}
            onRetry={() => {
              const current = activeId;
              setActiveId(null);
              setTimeout(() => setActiveId(current), 0);
            }}
          >
            <AssetDetail
              id={activeId}
              onClose={() => setActiveId(null)}
              onAssetChanged={updateAssetItem}
              onSavingChange={setIsSavingDetail}
            />
          </PanelBoundary>
        )}
      </main>
    </div>
  );
}
