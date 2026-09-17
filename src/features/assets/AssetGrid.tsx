import { useRef, useState, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Asset } from '@/lib/types';
import { AssetCard } from './AssetCard';

interface Props {
  assets: Asset[];
  loading?: boolean;
  loadingMore?: boolean;
  error?: string | null;
  loadMoreError?: string | null;
  hasMore?: boolean;
  selectedIds: Set<string>;
  activeId: string | null;
  onToggleSelect: (id: string) => void;
  onOpen: (id: string) => void;
  onLoadMore?: () => void;
}

const CARD_MIN_WIDTH = 220;
const GAP = 12;
const PADDING = 32; // 16px left + 16px right
const ESTIMATED_ROW_HEIGHT = 240;

export function AssetGrid({
  assets,
  loading,
  loadingMore,
  error,
  loadMoreError,
  hasMore,
  selectedIds,
  activeId,
  onToggleSelect,
  onOpen,
  onLoadMore,
}: Readonly<Props>) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1200,
  );

  // Measure container width for responsive column calculation
  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;

    // Initial sync measurement
    if (el.clientWidth > 0) {
      setContainerWidth(el.clientWidth);
    }

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0) {
          setContainerWidth(entry.contentRect.width);
        }
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const availableWidth = Math.max(0, containerWidth - PADDING);
  const columns = Math.max(1, Math.floor((availableWidth + GAP) / (CARD_MIN_WIDTH + GAP)));
  const rowCount = Math.ceil(assets.length / columns);
  const totalVirtualCount = hasMore ? rowCount + 1 : rowCount;

  const rowVirtualizer = useVirtualizer({
    count: totalVirtualCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    overscan: 2,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  const lastItem = virtualItems.at(-1);

  const prevColumnsRef = useRef(columns);

  // Preserve scroll anchoring when container width/column count changes (e.g. panel open/close or window resize)
  useEffect(() => {
    if (prevColumnsRef.current !== columns) {
      const prevCols = prevColumnsRef.current;
      prevColumnsRef.current = columns;
      const el = parentRef.current;
      if (el && prevCols > 0) {
        const currentScrollTop = el.scrollTop;
        const topRow = Math.floor(currentScrollTop / ESTIMATED_ROW_HEIGHT);
        const topAssetIndex = topRow * prevCols;
        const newRow = Math.floor(topAssetIndex / columns);
        rowVirtualizer.scrollToIndex(newRow, { align: 'start' });
      }
    }
  }, [columns, rowVirtualizer]);

  // Auto-trigger loadMore when scrolling near the bottom
  useEffect(() => {
    if (!lastItem || !hasMore || loadingMore || loading || !onLoadMore) return;
    if (lastItem.index >= rowCount - 1) {
      onLoadMore();
    }
  }, [lastItem?.index, rowCount, hasMore, loadingMore, loading, onLoadMore]);

  const renderContent = () => {
    if (loading && assets.length === 0) {
      return (
        <div className="empty">
          <p>Loading assets…</p>
        </div>
      );
    }

    if (error && assets.length === 0) {
      return (
        <div className="empty">
          <p className="error">{error}</p>
        </div>
      );
    }

    if (assets.length === 0) {
      return (
        <div className="empty">
          <p>Nothing matches these filters.</p>
          <p className="muted">Clear the search box or widen the status filter.</p>
        </div>
      );
    }

    return (
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualItems.map((virtualRow) => {
          const isLoaderRow = virtualRow.index >= rowCount;

          if (isLoaderRow) {
            return (
              <div
                key="loader-row"
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                {loadingMore && (
                  <div className="load-more-row">
                    <span className="muted">Loading more assets…</span>
                  </div>
                )}
                {loadMoreError && (
                  <div className="load-more-row">
                    <span className="error">{loadMoreError}</span>
                    <button type="button" onClick={() => onLoadMore?.()}>
                      Retry
                    </button>
                  </div>
                )}
              </div>
            );
          }

          const startIndex = virtualRow.index * columns;
          const rowAssets = assets.slice(startIndex, startIndex + columns);

          return (
            <div
              key={virtualRow.key}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
                display: 'grid',
                gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                gap: `${GAP}px`,
                padding: '0 16px',
                boxSizing: 'border-box',
              }}
            >
              {rowAssets.map((asset) => (
                <AssetCard
                  key={asset.id}
                  asset={asset}
                  isSelected={selectedIds.has(asset.id)}
                  isActive={activeId === asset.id}
                  onToggleSelect={onToggleSelect}
                  onOpen={onOpen}
                />
              ))}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div
      ref={parentRef}
      className="grid"
      role="grid"
      aria-label="Assets Library"
    >
      {renderContent()}
    </div>
  );
}

