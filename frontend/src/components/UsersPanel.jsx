import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Pencil, Trash2, Upload, UserCheck, UserX, UserPlus,
} from 'lucide-react';
import api, { errorMessage } from '../api';
import Banner from './Banner';
import ClearAllUsersModal from './ClearAllUsersModal';
import FieldFilterBar from './FieldFilterBar';
import UserBulkUpload from './UserBulkUpload';
import UserModal from './UserModal';
import { useAuth } from '../context/AuthContext';
import {
  EMPTY_FILTER, applyFieldFilter, isFiltering, optionsFrom,
} from '../lib/fieldFilter';
import { formatDate } from '../lib/dates';
import { userHaystack } from '../lib/userSearch';
import { ALL_ROLES, canManageAccount } from '../lib/roles';
import './UsersPanel.css';

const ROLE_DOT = {
  superadmin: 'var(--accent)',
  admin: 'var(--accent-soft, var(--accent))',
  verifier: 'var(--accent-ring, var(--accent))',
  viewer: 'var(--text-secondary, var(--text-muted))',
  assignee: 'var(--text-muted)',
};

const roleDotColor = (role) => ROLE_DOT[role] || 'var(--text-muted)';

const UsersPanel = () => {
  const { user: me, isSuperadmin } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState(null);
  const [modalUser, setModalUser] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [filter, setFilter] = useState(EMPTY_FILTER);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading((prev) => (prev ? prev : true));
    try {
      const res = await api.get('/users');
      setUsers(res.data || []);
    } catch (err) {
      setBanner({ text: errorMessage(err, 'Could not load users.'), kind: 'error' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filterFields = useMemo(() => [
    { key: 'username', label: 'Username', search: true, get: (u) => u.username },
    { key: 'fullName', label: 'Full Name', search: true, get: (u) => u.fullName },
    { key: 'email', label: 'Email ID', search: true, get: (u) => u.email },
    {
      key: 'location', label: 'Location', search: true, get: (u) => u.location,
      options: optionsFrom(users, (u) => u.location),
    },
    { key: 'dateOfJoining', label: 'Date of Joining', date: true, get: (u) => u.dateOfJoining },
    {
      key: 'role', label: 'Role', get: (u) => u.role,
      options: ALL_ROLES.filter((r) => users.some((u) => u.role === r)).map((r) => ({ value: r, label: r })),
    },
    {
      key: 'status', label: 'Status', get: (u) => (u.isActive ? 'active' : 'inactive'),
      options: [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }],
    },
  ], [users]);

  const shown = useMemo(
    () => applyFieldFilter(users, filter, filterFields, userHaystack),
    [users, filter, filterFields],
  );
  const searching = isFiltering(filter);

  const fmtDate = formatDate;

  const openCreate = () => { setModalUser(null); setModalOpen(true); };
  const openEdit = (u) => { setModalUser(u); setModalOpen(true); };

  const handleSaved = async (message) => {
    if (modalUser === null) setFilter(EMPTY_FILTER);
    setModalOpen(false);
    setModalUser(null);
    setBanner({ text: message, kind: 'success' });
    await load();
  };

  const toggleActive = async (u) => {
    setBusyId(u.id);
    try {
      await api.patch(`/users/${encodeURIComponent(u.id)}`, { isActive: !u.isActive });
      setBanner({
        text: `User "${u.username}" ${u.isActive ? 'deactivated' : 'activated'}.`,
        kind: 'success',
      });
      await load();
    } catch (err) {
      setBanner({ text: errorMessage(err, 'Could not update user.'), kind: 'error' });
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (u) => {
    if (!window.confirm(`Delete user "${u.username}"? Their account will no longer be able to sign in.`)) return;
    setBusyId(u.id);
    try {
      await api.delete(`/users/${encodeURIComponent(u.id)}`);
      setBanner({ text: `User "${u.username}" deleted.`, kind: 'success' });
      await load();
    } catch (err) {
      setBanner({ text: errorMessage(err, 'Could not delete user.'), kind: 'error' });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <Banner banner={banner} onDismiss={() => setBanner(null)} />

      <FieldFilterBar
        fields={filterFields}
        value={filter}
        onChange={setFilter}
        allPlaceholder="Search by name, username or email…"
      >
        <span className="users-meta">
          {searching
            ? `${shown.length.toLocaleString('en-IN')} of ${users.length.toLocaleString('en-IN')} account(s)`
            : `${users.length.toLocaleString('en-IN')} account(s)`}
        </span>

        {isSuperadmin && users.length > 1 && (
          <button
            type="button"
            className="users-clear-btn"
            onClick={() => setClearOpen(true)}
          >
            Clear all users&hellip;
          </button>
        )}
        <button type="button" className="btn-secondary users-create-btn" onClick={() => setBulkOpen(true)}>
          <Upload size={14} /> Bulk upload
        </button>
        <button type="button" className="btn-primary users-create-btn" onClick={openCreate}>
          <UserPlus size={14} /> New User
        </button>
      </FieldFilterBar>

      <div className="data-table-wrap master-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Username</th>
              <th>Full Name</th>
              <th>Email ID</th>
              <th>Location</th>
              <th>Date of Joining</th>
              <th>Role</th>
              <th>Status</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td className="table-empty" colSpan={9}>Loading accounts&hellip;</td></tr>
            )}
            {!loading && users.length === 0 && (
              <tr><td className="table-empty" colSpan={9}>No users yet.</td></tr>
            )}
            {!loading && users.length > 0 && shown.length === 0 && (
              <tr>
                <td className="table-empty" colSpan={9}>
                  No account matches {filter.query.trim()
                    ? <>&ldquo;{filter.query.trim()}&rdquo;</> : 'these filters'}.{' '}
                  <button type="button" className="users-empty-clear" onClick={() => setFilter(EMPTY_FILTER)}>
                    Clear the filters
                  </button>
                </td>
              </tr>
            )}
            {!loading && shown.map((u) => {
              const isSelf = me?.id === u.id;
              const manageable = canManageAccount(me?.role, u.role);
              const noRights = "Only a superadmin can change a superadmin's account";
              return (
                <tr key={u.id}>
                  <td>{u.username}</td>
                  <td>{u.fullName || ''}</td>
                  <td className="users-email-cell">
                    {u.email
                      ? <a href={`mailto:${u.email}`} className="users-email">{u.email}</a>
                      : <span className="users-email-missing">&mdash;</span>}
                  </td>
                  <td>
                    {u.location || <span className="users-email-missing">&mdash;</span>}
                  </td>
                  <td>
                    {u.dateOfJoining
                      ? fmtDate(u.dateOfJoining)
                      : <span className="users-email-missing">&mdash;</span>}
                  </td>
                  <td>
                    <span className="status-badge">
                      <span className="status-dot" style={{ background: roleDotColor(u.role) }} />
                      {u.role}
                    </span>
                  </td>
                  <td>
                    <span className="status-badge">
                      <span
                        className="status-dot"
                        style={{ background: u.isActive ? 'var(--good)' : 'var(--critical)' }}
                      />
                      {u.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>{fmtDate(u.createdAt)}</td>
                  <td className="actions-cell">
                    <button
                      type="button"
                      className="icon-btn"
                      disabled={!manageable}
                      title={manageable ? 'Edit' : noRights}
                      aria-label="Edit"
                      onClick={() => openEdit(u)}
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      disabled={isSelf || !manageable || busyId === u.id}
                      title={isSelf ? "You can't deactivate your own account"
                        : (!manageable ? noRights : (u.isActive ? 'Deactivate' : 'Activate'))}
                      aria-label={u.isActive ? 'Deactivate' : 'Activate'}
                      onClick={() => toggleActive(u)}
                    >
                      {u.isActive ? <UserX size={13} /> : <UserCheck size={13} />}
                    </button>
                    <button
                      type="button"
                      className="icon-btn icon-btn-danger"
                      disabled={isSelf || !manageable || busyId === u.id}
                      title={isSelf ? "You can't delete your own account"
                        : (!manageable ? noRights : 'Delete')}
                      aria-label="Delete"
                      onClick={() => handleDelete(u)}
                    >
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {modalOpen && (
        <UserModal
          user={modalUser}
          onClose={() => { setModalOpen(false); setModalUser(null); }}
          onSaved={handleSaved}
        />
      )}

      {bulkOpen && (
        <UserBulkUpload
          onClose={() => setBulkOpen(false)}
          onDone={(r) => {
            setFilter(EMPTY_FILTER);
            setBanner({
              text: `User list uploaded: ${r.created.length} created, ${r.updated.length} updated, `
                + `${r.unchanged} already up to date, ${r.skipped.length} skipped.`,
              kind: r.skipped.length ? 'info' : 'success',
            });
            load();
          }}
        />
      )}

      {clearOpen && (
        <ClearAllUsersModal
          total={users.length}
          onClose={() => setClearOpen(false)}
          onCleared={(message) => {
            setClearOpen(false);
            setFilter(EMPTY_FILTER);
            setBanner({ text: message, kind: 'success' });
            load();
          }}
        />
      )}
    </>
  );
};

export default UsersPanel;
