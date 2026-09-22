import { useRef, useState, useEffect, useLayoutEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Asset } from '@/lib/types';
import { AssetCard } from './AssetCard';

export interface AssetGridHandle {
  focusCard: (id: string) => void;
}

interface Props {
  assets: Asset[];
  loading?: boolean;
  loadingMore?: boolean;
  error?: string | null;
  loadMoreError?: string | null;
  hasMore?: boolean;
  selectedIds: Set<string>;
  activeId: string | null;
  focusedId: string | null;
  onFocusCard: (id: string) => void;
  onToggleSelect: (id: string, isShift?: boolean) => void;
  onOpen: (id: string) => void;
  onLoadMore?: () => void;
}

const CARD_MIN_WIDTH = 220;
const GAP = 12;
const PADDING = 32; // 16px left + 16px right
const CARD_ROW_HEIGHT = 240;
const ESTIMATED_ROW_HEIGHT = CARD_ROW_HEIGHT + GAP; // 252px (card height + 12px vertical gap)

export const AssetGrid = forwardRef<AssetGridHandle, Props>(function AssetGrid(
  {
    assets,
    loading,
    loadingMore,
    error,
    loadMoreError,
    hasMore,
    selectedIds,
    activeId,
    focusedId,
    onFocusCard,
    onToggleSelect,
    onOpen,
    onLoadMore,
  },
  ref,
) {
  const parentRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const shouldFocusOnMountRef = useRef(false);

  const [containerWidth, setContainerWidth] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1200,
  );

  // Measure container width for responsive column calculation
  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;

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

  useImperativeHandle(
    ref,
    () => ({
      focusCard(id: string) {
        const index = assets.findIndex((a) => a.id === id);
        if (index === -1) return;

        onFocusCard(id);
        const el = cardRefs.current.get(id);
        if (el) {
          el.focus();
        } else {
          shouldFocusOnMountRef.current = true;
          const targetRow = Math.floor(index / columns);
          rowVirtualizer.scrollToIndex(targetRow, { align: 'auto' });
        }
      },
    }),
    [assets, columns, onFocusCard, rowVirtualizer],
  );

  const virtualItems = rowVirtualizer.getVirtualItems();
  const lastItem = virtualItems.at(-1);

  const prevColumnsRef = useRef(columns);

  // Preserve scroll anchoring when container width/column count changes
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

  // Unmount / Filter Strategy: ensure focusedId points to an existing asset
  useEffect(() => {
    if (assets.length === 0) return;
    const exists = assets.some((a) => a.id === focusedId);
    if (!exists && assets[0]) {
      onFocusCard(assets[0].id);
      if (document.activeElement === document.body) {
        shouldFocusOnMountRef.current = true;
      }
    }
  }, [assets, focusedId, onFocusCard]);

  // Synchronize focus after scrolling or virtual items re-render
  useLayoutEffect(() => {
    if (!focusedId) return;
    const el = cardRefs.current.get(focusedId);
    if (el && shouldFocusOnMountRef.current) {
      el.focus();
      shouldFocusOnMountRef.current = false;
    }
  }, [focusedId, virtualItems]);

  const effectiveFocusedId = focusedId ?? (assets[0]?.id ?? null);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (assets.length === 0) return;

      const currentIdx = effectiveFocusedId
        ? assets.findIndex((a) => a.id === effectiveFocusedId)
        : 0;
      const validIndex = currentIdx === -1 ? 0 : currentIdx;

      let nextIndex = validIndex;
      let handled = false;

      switch (e.key) {
        case 'ArrowLeft':
          nextIndex = Math.max(0, validIndex - 1);
          handled = true;
          break;
        case 'ArrowRight':
          nextIndex = Math.min(assets.length - 1, validIndex + 1);
          handled = true;
          break;
        case 'ArrowUp':
          nextIndex = Math.max(0, validIndex - columns);
          handled = true;
          break;
        case 'ArrowDown':
          nextIndex = Math.min(assets.length - 1, validIndex + columns);
          handled = true;
          break;
        case 'Home':
          nextIndex = 0;
          handled = true;
          break;
        case 'End':
          nextIndex = assets.length - 1;
          handled = true;
          break;
        case 'PageUp':
          nextIndex = Math.max(0, validIndex - columns * 4);
          handled = true;
          break;
        case 'PageDown':
          nextIndex = Math.min(assets.length - 1, validIndex + columns * 4);
          handled = true;
          break;
        case 'Enter':
          e.preventDefault();
          if (assets[validIndex]) {
            onOpen(assets[validIndex].id);
          }
          return;
        case ' ':
          e.preventDefault();
          if (assets[validIndex]) {
            onToggleSelect(assets[validIndex].id, e.shiftKey);
          }
          return;
        default:
          return;
      }

      if (handled) {
        e.preventDefault();
        const nextAsset = assets[nextIndex];
        if (!nextAsset) return;

        shouldFocusOnMountRef.current = true;
        onFocusCard(nextAsset.id);

        if (e.shiftKey) {
          onToggleSelect(nextAsset.id, true);
        }

        const targetRow = Math.floor(nextIndex / columns);
        rowVirtualizer.scrollToIndex(targetRow, { align: 'auto' });
      }
    },
    [assets, effectiveFocusedId, columns, onOpen, onToggleSelect, onFocusCard, rowVirtualizer],
  );

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
            // eslint-disable-next-line sonarjs/prefer-html-elements -- Virtualized grid row: <tr> cannot be absolutely positioned
            <div
              key={virtualRow.key}
              role="row"
              aria-rowindex={virtualRow.index + 1}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${CARD_ROW_HEIGHT}px`,
                transform: `translateY(${virtualRow.start}px)`,
                display: 'grid',
                gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                gap: `${GAP}px`,
                padding: '0 16px',
                boxSizing: 'border-box',
                zIndex: rowAssets.some((a) => a.id === effectiveFocusedId) ? 2 : 1,
              }}
            >
              {rowAssets.map((asset) => (
                <AssetCard
                  key={asset.id}
                  ref={(el) => {
                    if (el) {
                      cardRefs.current.set(asset.id, el);
                    } else {
                      cardRefs.current.delete(asset.id);
                    }
                  }}
                  asset={asset}
                  isSelected={selectedIds.has(asset.id)}
                  isActive={activeId === asset.id}
                  tabIndex={effectiveFocusedId === asset.id ? 0 : -1}
                  onToggleSelect={onToggleSelect}
                  onOpen={onOpen}
                  onFocusCard={onFocusCard}
                />
              ))}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    // eslint-disable-next-line sonarjs/prefer-html-elements -- Virtualized grid: `<tr>` cannot be absolutely positioned or used with CSS Grid. This is the WAI-ARIA Authoring Practices pattern for virtualized grids; verified with VoiceOver.
    <div
      ref={parentRef}
      className="grid"
      role="grid"
      aria-label="Assets Library"
      aria-rowcount={rowCount}
      aria-colcount={columns}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      {renderContent()}
    </div>
  );
});

