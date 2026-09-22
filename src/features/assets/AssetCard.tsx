import { useState, forwardRef, memo } from 'react';
import { thumbnailUrl } from '@/api/client';
import { formatBytes, formatDate, statusLabel } from '@/lib/format';
import type { Asset, AssetKind } from '@/lib/types';

function KindIcon({ kind }: Readonly<{ kind: AssetKind }>) {
  if (kind === 'video') {
    return (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <polygon points="5 3 19 12 5 21 5 3" fill="currentColor" opacity="0.2" />
        <polygon points="5 3 19 12 5 21 5 3" />
      </svg>
    );
  }
  if (kind === 'document') {
    return (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </svg>
    );
  }
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  );
}

export interface CardProps {
  asset: Asset;
  isSelected: boolean;
  isActive: boolean;
  tabIndex?: number;
  onToggleSelect: (id: string, isShift?: boolean) => void;
  onOpen: (id: string) => void;
  onFocusCard?: (id: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>, id: string) => void;
}

export const AssetCard = memo(
  forwardRef<HTMLDivElement, CardProps>(function AssetCard(
    {
      asset,
      isSelected,
      isActive,
      tabIndex = -1,
      onToggleSelect,
      onOpen,
      onFocusCard,
      onKeyDown,
    },
    ref,
  ) {
    const isFocused = tabIndex === 0;
    const [imgError, setImgError] = useState(false);
    const showFallback = !asset.hasThumbnail || imgError;

    const accessibleLabel = `${asset.name}, ${asset.kind}, ${statusLabel(asset.status)}${
      isSelected ? ', selected' : ''
    }`;

    return (
      <div
        ref={ref}
        role="gridcell"
        tabIndex={tabIndex}
        aria-selected={isSelected}
        aria-label={accessibleLabel}
        data-focused={isFocused ? 'true' : undefined}
        className={
          'card' +
          (isSelected ? ' card--selected' : '') +
          (isActive ? ' card--active' : '') +
          (isFocused ? ' card--focused' : '')
        }
        onClick={() => {
          onFocusCard?.(asset.id);
          onOpen(asset.id);
        }}
        onFocus={() => onFocusCard?.(asset.id)}
        onKeyDown={(e) => onKeyDown?.(e, asset.id)}
      >
        <div className="card__thumb-wrap" aria-hidden="true">
          {showFallback ? (
            <div className="card__thumb-placeholder">
              <KindIcon kind={asset.kind} />
              <span className="card__thumb-kind">{asset.kind}</span>
            </div>
          ) : (
            <img
              className="card__thumb"
              src={thumbnailUrl(asset.id)}
              alt=""
              loading="lazy"
              onError={() => setImgError(true)}
            />
          )}
        </div>

        <div className="card__body" aria-hidden="true">
          <p className="card__name" title={asset.name}>
            {asset.name}
          </p>
          <p className="muted">
            {asset.kind} · {formatBytes(asset.sizeBytes)} · {formatDate(asset.updatedAt)}
          </p>
          <span className={`pill pill--${asset.status}`}>{statusLabel(asset.status)}</span>
        </div>

        <input
          type="checkbox"
          className="card__check"
          checked={isSelected}
          tabIndex={-1}
          aria-hidden="true"
          onClick={(e) => {
            e.stopPropagation();
            onFocusCard?.(asset.id);
            onToggleSelect(asset.id, e.shiftKey);
          }}
          onChange={() => {
            // Visual toggle handled via onClick with shiftKey detection
          }}
        />
      </div>
    );
  }),
);
