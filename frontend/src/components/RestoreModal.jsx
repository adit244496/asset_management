import { useMemo, useState } from 'react';
import { RotateCcw, X } from 'lucide-react';
import { errorMessage } from '../api';
import { useAssets } from '../context/AssetsContext';
import { isInStock } from '../lib/statusClass';
import './RestoreModal.css';

const RestoreModal = ({ row, noun, onClose, onRestored }) => {
  const { formOptionsFor, restoreAsset } = useAssets();

  const statuses = useMemo(
    () => formOptionsFor('status').filter((s) => s.trim().toUpperCase() !== 'SCRAP'),
    [formOptionsFor],
  );

  const previous = (row.previousStatus || '').trim();
  const previousMatch = statuses.find((s) => s.toLowerCase() === previous.toLowerCase()) || '';
  const previousRetired = previous !== '' && previousMatch === '';

  const [status, setStatus] = useState(previousMatch);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const label = row.assetTag || row.model || row.assetId;
  const releases = status && isInStock(status) && (row.user || row.email);

  const handleRestore = async () => {
    if (!status) {
      setError('Choose a status to restore it as.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await restoreAsset(row.id, status);
      onRestored(`"${label}" (${row.assetId}) restored as ${status}.`);
    } catch (err) {
      setError(errorMessage(err, `Could not restore this ${noun}.`));
      setSaving(false);
    }
  };

  return (
    <div
      className="modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}
    >
      <div className="modal restore-modal" role="dialog" aria-labelledby="restoreTitle">
        <div className="modal-head">
          <h2 id="restoreTitle">Restore {noun}</h2>
          <button type="button" className="modal-close" onClick={onClose} title="Close"
            disabled={saving}>
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          {error && <div className="banner banner-error">{error}</div>}

          <p className="restore-lede">
            <strong>{label}</strong> ({row.assetId}) is scrapped. Restoring brings it
            back into the register with the status you choose below.
          </p>

          <div className="field">
            <label htmlFor="restoreStatus">Restore as *</label>
            <select
              id="restoreStatus"
              className="field-input"
              value={status}
              onChange={(e) => { setStatus(e.target.value); setError(''); }}
              disabled={saving}
              autoFocus
            >
              {!status && <option value="">— choose a status —</option>}
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {s}{s === previousMatch ? ' — what it was before it was scrapped' : ''}
                </option>
              ))}
            </select>

            {previousRetired && (
              <p className="restore-hint">
                It was <strong>{previous}</strong> when it was scrapped, but that is no
                longer an active status in Master Data. Choose one of the current ones.
              </p>
            )}
            {!previous && (
              <p className="restore-hint">
                This {noun} was scrapped before its previous status was recorded, so
                there is nothing to put back. Choose the status it should return as.
              </p>
            )}
            {!statuses.length && (
              <p className="restore-hint">
                There are no active statuses in Master Data. Add one there first.
              </p>
            )}

            {releases && (
              <p className="restore-hint">
                In stock means nobody has it, so restoring it as <strong>{status}</strong> also
                clears the assigned user{row.user ? <> (<strong>{row.user}</strong>)</> : ''}.
              </p>
            )}
          </div>
        </div>

        <div className="modal-foot">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary restore-confirm"
            onClick={handleRestore}
            disabled={saving || !status}
          >
            <RotateCcw size={14} /> {saving ? 'Restoring…' : 'Restore'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default RestoreModal;
