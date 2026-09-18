import { useEffect, useState } from 'react';
import { getAsset, thumbnailUrl, updateAsset, ApiError } from '@/api/client';
import { formatBytes, formatDate, formatDuration, statusLabel } from '@/lib/format';
import type { Asset, AssetStatus } from '@/lib/types';

const STATUSES: AssetStatus[] = ['draft', 'in_review', 'approved', 'archived'];

interface Props {
  id: string;
  onClose: () => void;
  onAssetChanged: (asset: Asset) => void;
}

interface ConflictState {
  desiredStatus: AssetStatus;
  serverAsset: Asset;
}

export function AssetDetail({ id, onClose, onAssetChanged }: Readonly<Props>) {
  const [asset, setAsset] = useState<Asset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<ConflictState | null>(null);

  useEffect(() => {
    setAsset(null);
    setError(null);
    setConflict(null);
    getAsset(id)
      .then(setAsset)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Load failed'));
  }, [id]);

  async function saveStatus(status: AssetStatus, targetVersion?: number, fromConflict = false) {
    if (!asset) return;
    const versionToUse = targetVersion ?? asset.version;
    setSaving(true);
    setError(null);
    if (!fromConflict) {
      setConflict(null);
    }
    try {
      const updated = await updateAsset(asset.id, versionToUse, { status });
      setAsset(updated);
      onAssetChanged(updated);
      setConflict(null);
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 409) {
        try {
          const fresh = await getAsset(asset.id);
          setConflict({ desiredStatus: status, serverAsset: fresh });
        } catch {
          setError('Version conflict occurred. Failed to fetch latest version.');
        }
      } else {
        setError(err instanceof Error ? err.message : 'Save failed');
      }
    } finally {
      setSaving(false);
    }
  }

  function handleReloadLatest() {
    if (!conflict) return;
    setAsset(conflict.serverAsset);
    onAssetChanged(conflict.serverAsset);
    setConflict(null);
    setError(null);
  }

  function handleOverwrite() {
    if (!conflict) return;
    saveStatus(conflict.desiredStatus, conflict.serverAsset.version, true);
  }

  return (
    <aside className="panel">
      <div className="panel__head">
        <h2>Asset detail</h2>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>

      {error && <p className="error">{error}</p>}
      {!asset && !error && <p className="muted">Loading…</p>}

      {conflict && (
        <div className="conflict-banner">
          <p>
            <strong>Conflict:</strong> This asset was modified elsewhere (now v
            {conflict.serverAsset.version}, {statusLabel(conflict.serverAsset.status)}).
          </p>
          <div className="conflict-banner__actions">
            <button type="button" disabled={saving} onClick={handleReloadLatest}>
              Reload latest (v{conflict.serverAsset.version})
            </button>
            <button type="button" disabled={saving} onClick={handleOverwrite}>
              Overwrite with {statusLabel(conflict.desiredStatus).toLowerCase()}
            </button>
          </div>
        </div>
      )}

      {asset && (
        <div className="panel__body">
          <img className="panel__thumb" src={thumbnailUrl(asset.id)} alt="" />
          <h3>{asset.name}</h3>
          <dl className="facts">
            <dt>Id</dt>
            <dd>{asset.id}</dd>
            <dt>Kind</dt>
            <dd>{asset.kind}</dd>
            <dt>Size</dt>
            <dd>{formatBytes(asset.sizeBytes)}</dd>
            {asset.width && (
              <>
                <dt>Dimensions</dt>
                <dd>
                  {asset.width}×{asset.height}
                </dd>
              </>
            )}
            {asset.durationSec && (
              <>
                <dt>Duration</dt>
                <dd>{formatDuration(asset.durationSec)}</dd>
              </>
            )}
            <dt>Owner</dt>
            <dd>{asset.owner.name}</dd>
            <dt>Updated</dt>
            <dd>{formatDate(asset.updatedAt)}</dd>
            <dt>Version</dt>
            <dd>{asset.version}</dd>
          </dl>

          {asset.tags.length > 0 && (
            <ul className="tags">
              {asset.tags.map((tag) => (
                <li key={tag}>{tag}</li>
              ))}
            </ul>
          )}

          <p className="muted">Status</p>
          <div className="row">
            {STATUSES.map((status) => (
              <button
                type="button"
                key={status}
                disabled={saving || status === asset.status}
                onClick={() => saveStatus(status)}
              >
                {statusLabel(status)}
              </button>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}
