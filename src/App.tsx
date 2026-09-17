import { useState, useEffect, useCallback } from 'react';
import { bulkSetStatus } from '@/api/client';
import { AssetDetail } from '@/features/assets/AssetDetail';
import { AssetGrid } from '@/features/assets/AssetGrid';
import { useAssets } from '@/features/assets/useAssets';
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

function getInitialParams() {
  const params = new URLSearchParams(window.location.search);
  const q = params.get('q') ?? '';
  const status = (params.get('status')?.split(',').filter(Boolean) as AssetStatus[]) ?? [];
  const kind = (params.get('kind')?.split(',').filter(Boolean) as AssetKind[]) ?? [];
  const tag = params.get('tag')?.split(',').filter(Boolean) ?? [];
  const sort = (params.get('sort') as NonNullable<AssetQuery['sort']>) ?? 'updatedAt:desc';
  return { q, status, kind, tag, sort };
}

export function App() {
  const initial = getInitialParams();
  const [q, setQ] = useState(initial.q);
  const [debouncedQ, setDebouncedQ] = useState(initial.q);
  const [status, setStatus] = useState<AssetStatus[]>(initial.status);
  const [kind, setKind] = useState<AssetKind[]>(initial.kind);
  const [tag] = useState<string[]>(initial.tag);
  const [sort, setSort] = useState<NonNullable<AssetQuery['sort']>>(initial.sort);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQ(q);
    }, 300); // 300ms debounce interval
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
    // Use replaceState so typing doesn't create dozens of history entries
    window.history.replaceState(null, '', newUrl);
  }, [debouncedQ, sort, status, kind, tag]);

  const { items, total, loading, loadingMore, error, loadMoreError, hasMore, loadMore } =
    useAssets({
      q: debouncedQ,
      status,
      kind,
      tag,
      sort,
      limit: 24,
    });

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  async function applyBulkStatus(next: AssetStatus) {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    setNotice(null);
    try {
      // Sends every selected id in one call, which the API refuses above 50.
      const result = await bulkSetStatus(ids, next);
      setNotice(`${result.applied} updated, ${result.failed} failed.`);
      setSelectedIds(new Set());
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Bulk update failed');
    }
  }

  function handleSaved(_asset: Asset) {
    // The list is not told that anything changed, so it shows stale rows.
  }

  return (
    <div className="app">
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

      {selectedIds.size > 0 && (
        <div className="bulkbar">
          <span>{selectedIds.size} selected</span>
          {STATUSES.map((s) => (
            <button key={s} onClick={() => applyBulkStatus(s)}>
              Set {statusLabel(s).toLowerCase()}
            </button>
          ))}
          <button onClick={() => setSelectedIds(new Set())}>Clear selection</button>
        </div>
      )}

      {notice && <p className="notice">{notice}</p>}
      {error && <p className="error">{error}</p>}

      <main className="content">
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
        {activeId && (
          <AssetDetail id={activeId} onClose={() => setActiveId(null)} onSaved={handleSaved} />
        )}
      </main>
    </div>
  );
}
