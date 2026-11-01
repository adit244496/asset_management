import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import api, { errorMessage } from '../api';
import { useAssets } from '../context/AssetsContext';
import { useAuth } from '../context/AuthContext';
import './ClearAllModal.css';

const REGISTER_LABELS = [['assets', 'Assets'], ['peripherals', 'Peripherals'], ['softwares', 'Softwares']];

async function blobError(err, fallback) {
  const data = err?.response?.data;
  if (data instanceof Blob) {
    try {
      const parsed = JSON.parse(await data.text());
      if (parsed?.detail) return String(parsed.detail);
    } catch {  }
  }
  return errorMessage(err, fallback);
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const ClearAllModal = ({ onClose, onCleared }) => {
  const { invalidateAll } = useAssets();
  const { user } = useAuth();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [clearing, setClearing] = useState(false);
  const [counts, setCounts] = useState(null);

  useEffect(() => {
    api.get('/data')
      .then((res) => setCounts(res.data?.counts || {}))
      .catch(() => setCounts({}));
  }, []);

  const total = counts ? Object.values(counts).reduce((a, b) => a + (b || 0), 0) : null;

  const handleClear = async () => {
    if (!password) {
      setError('Enter your account password to confirm.');
      return;
    }
    setClearing(true);
    setError('');
    try {
      const res = await api.delete('/data', { data: { password }, responseType: 'blob' });
      const named = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(res.headers?.['content-disposition'] || '');
      const filename = named ? decodeURIComponent(named[1]) : 'it-asset-backup-before-clear.zip';
      saveBlob(res.data, filename);
      const gone = Object.fromEntries(String(res.headers?.['x-cleared'] || '').split(',')
        .filter(Boolean).map((p) => p.split('=')).map(([k, v]) => [k, Number(v) || 0]));
      invalidateAll();
      onCleared(`Cleared all data: ${REGISTER_LABELS.map(([k, label]) => `${(gone[k] ?? 0).toLocaleString('en-IN')} ${label.toLowerCase()}`).join(', ')} deleted. `
        + `A copy was downloaded as ${filename}. Numbering restarts at 000001. Master data, users and the Activity Log are kept.`);
    } catch (err) {
      setError(await blobError(err, 'Could not clear the data.'));
      setPassword('');
    } finally {
      setClearing(false);
    }
  };

  return (
    <div
      className="modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget && !clearing) onClose(); }}
    >
      <div className="modal modal-narrow">
        <div className="modal-head">
          <h2>Clear all data</h2>
          <button type="button" className="modal-close" onClick={onClose} title="Close" disabled={clearing}>
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          {error && <div className="banner banner-error">{error}</div>}

          <div className="clear-warning">
            <strong>
              This permanently deletes {total === null ? 'every record' : `all ${total.toLocaleString('en-IN')} records`} in
              Assets, Peripherals and Softwares.
            </strong>
            {counts && (
              <div className="field-hint">
                {REGISTER_LABELS.map(([k, label]) => `${(counts[k] ?? 0).toLocaleString('en-IN')} ${label}`).join(' · ')}
              </div>
            )}
            <ul>
              <li>Every record and its history is removed, including entries waiting in Verification.</li>
              <li>ID numbering restarts, so the next upload begins again at 000001.</li>
              <li>Before anything is deleted, a zip of every register&rsquo;s CSV (entries waiting in
                Verification in their own file) and the Master Data workbook is downloaded to this computer.</li>
              <li>Master data, user accounts and the Activity Log are <strong>not</strong> affected.</li>
              <li>This cannot be undone.</li>
            </ul>
          </div>

          <div className="field">
            <label htmlFor="clearAllPassword">
              Password for {user?.username ? <strong>{user.username}</strong> : 'your account'}
            </label>
            <input
              id="clearAllPassword"
              className="field-input"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleClear(); } }}
            />
            <div className="field-hint">
              Confirming with your own password is what makes this deliberate.
            </div>
          </div>
        </div>

        <div className="modal-foot">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={clearing}>Cancel</button>
          <button
            type="button"
            className="btn-danger"
            onClick={handleClear}
            disabled={clearing || !password}
          >
            {clearing ? 'Clearing…' : 'Clear all data'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ClearAllModal;
