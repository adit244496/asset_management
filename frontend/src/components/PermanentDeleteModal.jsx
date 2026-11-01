import { useState } from 'react';
import { X } from 'lucide-react';
import { errorMessage } from '../api';
import { useAssets } from '../context/AssetsContext';
import { useAuth } from '../context/AuthContext';
import './ClearAllModal.css';

const PermanentDeleteModal = ({ record, noun = 'asset', onClose, onDeleted }) => {
  const { purgeAsset } = useAssets();
  const { user } = useAuth();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);

  const label = record?.assetId || record?.assetTag || `this ${noun}`;

  const handleDelete = async () => {
    if (!password) {
      setError('Enter your account password to confirm.');
      return;
    }
    setDeleting(true);
    setError('');
    try {
      const body = await purgeAsset(record.id, password);
      onDeleted(body?.detail || `${label} was permanently deleted.`);
    } catch (err) {
      setError(errorMessage(err, `Could not delete this ${noun}.`));
      setPassword('');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div
      className="modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal modal-narrow">
        <div className="modal-head">
          <h2>Delete permanently</h2>
          <button type="button" className="modal-close" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          {error && <div className="banner banner-error">{error}</div>}

          <div className="clear-warning">
            <strong>
              This removes {label}
              {record?.assetTag && record?.assetId ? ` (${record.assetTag})` : ''} from the register.
            </strong>
            <ul>
              {record?.isDeleted ? (
                <li>
                  This {noun} is currently <strong>scrapped</strong>, which kept it
                  in the register and left it restorable. Deleting it now gives
                  that up.
                </li>
              ) : (
                <li>
                  Not the same as <strong>scrapping</strong> it. Scrapping keeps
                  the record, marks it INACTIVE and can be undone &mdash; if you
                  may want this {noun} back, cancel and scrap it instead.
                </li>
              )}
              <li>
                Its history is <strong>kept</strong>, including a record of this
                deletion and who made it.
              </li>
              <li>
                Its {noun === 'asset' ? 'Asset ID' : 'ID'} is not reissued, so no
                later record inherits its trail.
              </li>
              <li>This cannot be undone.</li>
            </ul>
          </div>

          <div className="field">
            <label htmlFor="purgePassword">
              Password for {user?.username ? <strong>{user.username}</strong> : 'your account'}
            </label>
            <input
              id="purgePassword"
              className="field-input"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleDelete(); } }}
            />
            <div className="field-hint">
              Confirming with your own password is what makes this deliberate.
            </div>
          </div>
        </div>

        <div className="modal-foot">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="btn-danger"
            onClick={handleDelete}
            disabled={deleting || !password}
          >
            {deleting ? 'Deleting…' : 'Delete permanently'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PermanentDeleteModal;
