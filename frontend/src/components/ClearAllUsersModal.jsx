import { useState } from 'react';
import { X } from 'lucide-react';
import api, { errorMessage } from '../api';
import { useAuth } from '../context/AuthContext';
import './ClearAllModal.css';

const ClearAllUsersModal = ({ total, onClose, onCleared }) => {
  const { user } = useAuth();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [clearing, setClearing] = useState(false);

  const doomed = Math.max(0, (total || 0) - 1);

  const handleClear = async () => {
    if (!password) {
      setError('Enter your account password to confirm.');
      return;
    }
    setClearing(true);
    setError('');
    try {
      const res = await api.delete('/users', { data: { password } });
      const n = res.data?.deleted ?? doomed;
      onCleared(`Deleted ${n.toLocaleString('en-IN')} account(s). Yours is the only one left.`);
    } catch (err) {
      setError(errorMessage(err, 'Could not clear the user list.'));
      setPassword('');
    } finally {
      setClearing(false);
    }
  };

  return (
    <div
      className="modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal modal-narrow">
        <div className="modal-head">
          <h2>Clear all users</h2>
          <button type="button" className="modal-close" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          {error && <div className="banner banner-error">{error}</div>}

          <div className="clear-warning">
            <strong>
              This permanently deletes {doomed.toLocaleString('en-IN')} account(s).
            </strong>
            <ul>
              <li>
                <strong>Your own account ({user?.username}) is kept</strong> &mdash; it has
                to be, or nobody could sign in afterwards.
              </li>
              <li>
                <strong>Every other account goes, including other admins.</strong> Anyone
                else who signs in will lose access until you recreate them.
              </li>
              <li>
                Unlike deleting one user, which only deactivates them, these rows are
                removed outright.
              </li>
              <li>
                Assets and their history are <strong>not</strong> affected &mdash; who
                created or changed each asset is recorded by name, so the trail survives.
              </li>
              <li>This cannot be undone.</li>
            </ul>
          </div>

          <div className="field">
            <label htmlFor="clearUsersPassword">
              Password for {user?.username ? <strong>{user.username}</strong> : 'your account'}
            </label>
            <input
              id="clearUsersPassword"
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
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="btn-danger"
            onClick={handleClear}
            disabled={clearing || !password || doomed === 0}
          >
            {clearing ? 'Deleting…' : `Delete ${doomed.toLocaleString('en-IN')} account(s)`}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ClearAllUsersModal;
