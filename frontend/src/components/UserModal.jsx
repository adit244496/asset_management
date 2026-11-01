import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import api, { errorMessage } from '../api';
import { useAssets } from '../context/AssetsContext';
import { useAuth } from '../context/AuthContext';
import { ASSIGNEE, ROLE_HINTS, ROLE_LABELS, grantableRoles } from '../lib/roles';
import DateInput from './DateInput';
import './UserModal.css';

const UserModal = ({ user, onClose, onSaved }) => {
  const isEdit = !!user;
  const [username, setUsername] = useState(user?.username || '');
  const [fullName, setFullName] = useState(user?.fullName || '');
  const [email, setEmail] = useState(user?.email || '');
  const [location, setLocation] = useState(user?.location || '');
  const [dateOfJoining, setDateOfJoining] = useState(user?.dateOfJoining || '');
  const { formOptionsFor } = useAssets();
  const locations = formOptionsFor('location', user?.location);
  const [role, setRole] = useState(user?.role || ASSIGNEE);
  const [isActive, setIsActive] = useState(user ? !!user.isActive : true);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const lockedToAssignee = isEdit && user?.role === ASSIGNEE;

  const { user: me } = useAuth();
  const roleOptions = useMemo(() => {
    const offered = grantableRoles(me?.role);
    return offered.includes(role) ? offered : [role, ...offered];
  }, [me?.role, role]);

  const handleSave = async () => {
    if (!isEdit && (!username.trim() || !fullName.trim() || !password)) {
      setError('Username, full name, and password are required.');
      return;
    }
    if (isEdit && !fullName.trim()) {
      setError('Full name is required.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      if (isEdit) {
        const payload = {
          fullName: fullName.trim(), email: email.trim(), location, dateOfJoining, isActive,
        };
        if (!lockedToAssignee) payload.role = role;
        if (password) payload.password = password;
        await api.patch(`/users/${encodeURIComponent(user.id)}`, payload);
      } else {
        await api.post('/users', {
          username: username.trim(),
          password,
          fullName: fullName.trim(),
          email: email.trim(),
          location,
          dateOfJoining,
          role,
        });
      }
      onSaved(isEdit
        ? `User "${user.username}" updated.`
        : `User "${username.trim()}" created.`);
    } catch (err) {
      setError(errorMessage(err, isEdit ? 'Could not update user.' : 'Could not create user.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal modal-narrow">
        <div className="modal-head">
          <h2>{isEdit ? 'Edit User' : 'New User'}</h2>
          <button type="button" className="modal-close" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          {error && <div className="banner banner-error">{error}</div>}

          <div className="user-form-grid">
            <div className="field">
              <label htmlFor="userUsername">Username *</label>
              <input
                id="userUsername"
                className="field-input"
                type="text"
                value={username}
                disabled={isEdit}
                onChange={(e) => setUsername(e.target.value)}
              />
              {isEdit && <div className="field-hint">Username can&apos;t be changed after creation.</div>}
            </div>

            <div className="field">
              <label htmlFor="userFullName">Full Name *</label>
              <input
                id="userFullName"
                className="field-input"
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="userEmail">Email ID</label>
              <input
                id="userEmail"
                className="field-input"
                type="email"
                autoComplete="off"
                placeholder="name@ambujaneotia.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <p className="field-hint">
                Optional. Filled in automatically for accounts created from an
                upload, using the Email ID beside their name in the file.
              </p>
            </div>

            <div className="field">
              <label htmlFor="userLocation">Location</label>
              <select
                id="userLocation"
                className="field-input"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              >
                <option value="">&mdash; not recorded &mdash;</option>
                {locations.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
              <p className="field-hint">
                Where this person sits. Used by Transfer to offer the people at
                a destination, so an asset is not moved to one place and handed
                to someone at another.
              </p>
            </div>

            <div className="field">
              <label htmlFor="userJoined">Date of Joining</label>
              <DateInput
                id="userJoined"
                className="field-input"
                value={dateOfJoining}
                onChange={setDateOfJoining}
              />
              <p className="field-hint">
                Optional. When this person joined &mdash; not when they got a
                machine, which each asset records as its Assigned Date.
              </p>
            </div>

            <div className="field">
              <label htmlFor="userRole">Profile *</label>
              <select
                id="userRole"
                className="field-input"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                disabled={lockedToAssignee}
              >
                {roleOptions.map((value) => (
                  <option key={value} value={value}>
                    {ROLE_LABELS[value]} &mdash; {ROLE_HINTS[value]}
                  </option>
                ))}
              </select>
              {lockedToAssignee && (
                <p className="field-hint">
                  An assignee&rsquo;s profile cannot be changed. Create a separate
                  account for this person if they need to sign in.
                </p>
              )}
            </div>

            {isEdit && (
              <div className="field">
                <label htmlFor="userActive">Status</label>
                <select
                  id="userActive"
                  className="field-input"
                  value={String(isActive)}
                  onChange={(e) => setIsActive(e.target.value === 'true')}
                >
                  <option value="true">Active</option>
                  <option value="false">Inactive &mdash; cannot sign in</option>
                </select>
              </div>
            )}

            <div className="field">
              <label htmlFor="userPassword">
                Password {isEdit ? '(leave blank to keep unchanged)' : '*'}
              </label>
              <input
                id="userPassword"
                className="field-input"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="modal-foot">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : (isEdit ? 'Save Changes' : 'Create User')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default UserModal;
