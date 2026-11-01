import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Eye, EyeOff, ListPlus, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import api, { errorMessage } from '../api';
import Banner from '../components/Banner';
import MasterBulkAdd from '../components/MasterBulkAdd';
import MasterWorkbookUpload from '../components/MasterWorkbookUpload';
import FieldFilterBar from '../components/FieldFilterBar';
import MasterOptionModal from '../components/MasterOptionModal';
import NotificationsPanel from '../components/NotificationsPanel';
import UsersPanel from '../components/UsersPanel';
import { useAuth } from '../context/AuthContext';
import { useMasters } from '../context/MastersContext';
import { EMPTY_FILTER, applyFieldFilter, isFiltering } from '../lib/fieldFilter';
import { masterHaystack } from '../lib/masterSearch';
import { downloadMasterWorkbook } from '../lib/masterWorkbook';
import { registerOf } from '../lib/registers';
import './MasterDataPage.css';

const USERS_TAB = 'users';
const NOTIFY_TAB = 'notifications';
const SUB_LISTS = { floor: 'location' };

const MasterDataPage = ({ initialTab = null }) => {
  const { categories, loaded, reload: reloadMasters } = useMasters();
  const { isSuperadmin } = useAuth();
  const [selected, setSelected] = useState(initialTab);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState(null);
  const [modalOption, setModalOption] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [filter, setFilter] = useState(EMPTY_FILTER);

  const active = (selected === NOTIFY_TAB && !isSuperadmin ? null : selected)
    || categories[0]?.key || null;
  const spec = categories.find((c) => c.key === active) || null;
  const parentOf = (c) => SUB_LISTS[c.key]
    || (c.classification ? categories.find((o) => o.field === c.field && o.classification)?.key : null);
  const tabLabel = (c) => (c.classification ? `${c.field[0].toUpperCase()}${c.field.slice(1)}s` : c.plural);
  const subLabel = (c) => (c.classification ? registerOf(c.classification).label : c.plural);
  const tabCategories = categories.filter((c) => !parentOf(c) || parentOf(c) === c.key);
  const activeTab = (spec && parentOf(spec)) || active;
  const family = categories.filter((c) => c.key === activeTab || parentOf(c) === activeTab);
  const showingUsers = active === USERS_TAB;
  const showingNotify = active === NOTIFY_TAB;

  const load = useCallback(async (key) => {
    if (!key || key === USERS_TAB || key === NOTIFY_TAB) return;
    setLoading((prev) => (prev ? prev : true));
    try {
      const res = await api.get(`/masters/${encodeURIComponent(key)}?includeInactive=true`);
      setRows(res.data?.items || []);
    } catch (err) {
      setBanner({ text: errorMessage(err, 'Could not load this master table.'), kind: 'error' });
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(active); }, [active, load]);

  const refreshAll = useCallback(async () => {
    await load(active);
    reloadMasters().catch(() => {  });
  }, [active, load, reloadMasters]);

  const selectCategory = (key) => {
    if (key === active) return;
    setSelected(key);
    setBanner(null);
    setFilter(EMPTY_FILTER);
  };

  const openCreate = () => { setModalOption(null); setModalOpen(true); };
  const openEdit = (row) => { setModalOption(row); setModalOpen(true); };

  const handleSaved = async (message) => {
    setModalOpen(false);
    setModalOption(null);
    setBanner({ text: message, kind: 'success' });
    await refreshAll();
  };

  const handleBulkDone = async (message) => {
    setBulkOpen(false);
    setBanner({ text: message, kind: 'success' });
    await refreshAll();
  };

  const downloadAll = async () => {
    setDownloading(true);
    try {
      const res = await api.get('/masters/export');
      await downloadMasterWorkbook(res.data?.categories || categories, res.data?.items || {}, {
        users: res.data?.users || [],
      });
    } catch (err) {
      setBanner({ text: errorMessage(err, 'Could not download the master data.'), kind: 'error' });
    } finally {
      setDownloading(false);
    }
  };

  const handleAllDone = async (message, kind = 'success') => {
    setUploadOpen(false);
    setBanner({ text: message, kind });
    await refreshAll();
  };

  const existingNames = rows.map((r) => r.name);

  const toggleActive = async (row) => {
    setBusyId(row.id);
    try {
      await api.patch(`/masters/${encodeURIComponent(active)}/${encodeURIComponent(row.id)}`, {
        isActive: !row.isActive,
      });
      setBanner({
        text: row.isActive
          ? `"${row.name}" retired — it is no longer offered on new assets. Existing assets are unchanged.`
          : `"${row.name}" reactivated.`,
        kind: 'success',
      });
      await refreshAll();
    } catch (err) {
      setBanner({ text: errorMessage(err, 'Could not update this value.'), kind: 'error' });
    } finally {
      setBusyId(null);
    }
  };

  const toggleShared = async (row) => {
    setBusyId(row.id);
    try {
      await api.patch(`/masters/type/${encodeURIComponent(row.id)}`, {
        isShared: !row.isShared,
      });
      setBanner({
        text: row.isShared
          ? `A "${row.name}" now belongs to one asset at a time — linking one to another `
            + 'asset will move it.'
          : `A "${row.name}" can now be linked to several assets at once.`,
        kind: 'success',
      });
      await refreshAll();
    } catch (err) {
      setBanner({ text: errorMessage(err, 'Could not update this value.'), kind: 'error' });
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (row) => {
    const label = spec?.label || 'value';
    if (!window.confirm(`Delete the ${label} "${row.name}"? This can't be undone.`)) return;
    setBusyId(row.id);
    try {
      await api.delete(`/masters/${encodeURIComponent(active)}/${encodeURIComponent(row.id)}`);
      setBanner({ text: `"${row.name}" deleted.`, kind: 'success' });
      await refreshAll();
    } catch (err) {
      setBanner({ text: errorMessage(err, 'Could not delete this value.'), kind: 'error' });
    } finally {
      setBusyId(null);
    }
  };

  const isTypes = active === 'type';
  const colCount = isTypes ? 4 : 3;

  const filterFields = useMemo(() => [
    { key: 'name', label: spec?.label || 'Value', search: true, get: (r) => r.name },
    { key: 'description', label: 'Description', search: true, get: (r) => r.description },
    {
      key: 'state', label: 'Active / Retired', get: (r) => (r.isActive ? 'active' : 'retired'),
      options: [{ value: 'active', label: 'Active' }, { value: 'retired', label: 'Retired' }],
    },
    {
      key: 'used', label: 'In use', get: (r) => ((r.inUse || 0) > 0 ? 'used' : 'unused'),
      options: [{ value: 'used', label: 'Used by records' }, { value: 'unused', label: 'Not used' }],
    },
    ...(isTypes ? [{
      key: 'shared', label: 'Shared', get: (r) => (r.isShared ? 'shared' : 'single'),
      options: [{ value: 'shared', label: 'Several assets' }, { value: 'single', label: 'One at a time' }],
    }] : []),
  ], [spec?.label, isTypes]);

  const shown = useMemo(
    () => applyFieldFilter(rows, filter, filterFields, masterHaystack),
    [rows, filter, filterFields],
  );
  const searching = isFiltering(filter);

  const activeCount = rows.filter((r) => r.isActive).length;
  const retiredCount = rows.length - activeCount;

  return (
    <div className="page-scroll">
      <div className="page-card">
        <div className="page-header master-page-header">
          <div>
            <h1>Master Data</h1>
          </div>
          {categories.length > 0 && !showingUsers && !showingNotify && (
            <div className="master-all-actions">
              <button
                type="button"
                className="btn-secondary master-create-btn"
                onClick={downloadAll}
                disabled={downloading}
                title="Every list and the users in one Excel workbook, a sheet each"
              >
                <Download size={14} /> {downloading ? 'Preparing…' : 'Download all'}
              </button>
              <button
                type="button"
                className="btn-secondary master-create-btn"
                onClick={() => setUploadOpen(true)}
                title="Fill the lists and users from a Master Data workbook"
              >
                <Upload size={14} /> Upload workbook
              </button>
            </div>
          )}
        </div>

      {!showingUsers && !showingNotify && <Banner banner={banner} onDismiss={() => setBanner(null)} />}

      {!categories.length ? (
        <div className="panel">
          {loaded ? 'No master tables are configured on the server.' : 'Loading master tables…'}
        </div>
      ) : (
        <>
          <div className="master-tabs" role="tablist">
            {tabCategories.map((c) => (
              <button
                key={c.key}
                type="button"
                role="tab"
                aria-selected={c.key === activeTab}
                className={`master-tab${c.key === activeTab ? ' active' : ''}`}
                onClick={() => selectCategory(c.key)}
              >
                {tabLabel(c)}
              </button>
            ))}
            <button
              type="button"
              role="tab"
              aria-selected={showingUsers}
              className={`master-tab master-tab-users${showingUsers ? ' active' : ''}`}
              onClick={() => selectCategory(USERS_TAB)}
            >
              Users
            </button>
            {isSuperadmin && (
              <button
                type="button"
                role="tab"
                aria-selected={showingNotify}
                className={`master-tab${showingNotify ? ' active' : ''}`}
                onClick={() => selectCategory(NOTIFY_TAB)}
              >
                Notifications
              </button>
            )}
          </div>

          {showingNotify ? <NotificationsPanel /> : showingUsers ? <UsersPanel /> : (
          <>
          {family.length > 1 && (
            <div className="master-sublists" role="tablist" aria-label={`${tabLabel(family[0])} lists`}>
              {family.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  role="tab"
                  aria-selected={c.key === active}
                  className={`master-sublist${c.key === active ? ' active' : ''}`}
                  onClick={() => selectCategory(c.key)}
                >
                  {subLabel(c)}
                </button>
              ))}
            </div>
          )}
          <FieldFilterBar
            key={active}
            fields={filterFields}
            value={filter}
            onChange={setFilter}
            allPlaceholder={`Search ${spec?.plural?.toLowerCase() || 'values'}…`}
          >
            <span className="master-meta">
              {searching && `${shown.length.toLocaleString('en-IN')} of ${rows.length.toLocaleString('en-IN')} — `}
              {activeCount.toLocaleString('en-IN')} active
              {retiredCount > 0 && `, ${retiredCount.toLocaleString('en-IN')} retired`}
            </span>
            <div className="master-toolbar-actions">
              <button type="button" className="btn-secondary master-create-btn" onClick={() => setBulkOpen(true)}>
                <ListPlus size={14} /> Bulk Add
              </button>
              <button type="button" className="btn-primary master-create-btn" onClick={openCreate}>
                <Plus size={14} /> New {spec?.label || 'Value'}
              </button>
            </div>
          </FieldFilterBar>

          <div className="data-table-wrap master-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{spec?.label || 'Value'}</th>
                  <th>Description</th>
                  {isTypes && <th>Shared</th>}
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td className="table-empty" colSpan={colCount}>Loading&hellip;</td></tr>
                )}
                {!loading && rows.length === 0 && (
                  <tr><td className="table-empty" colSpan={colCount}>No values yet.</td></tr>
                )}
                {!loading && rows.length > 0 && shown.length === 0 && (
                  <tr>
                    <td className="table-empty" colSpan={colCount}>
                      Nothing matches {filter.query.trim()
                        ? <>&ldquo;{filter.query.trim()}&rdquo;</> : 'these filters'}.{' '}
                      <button type="button" className="users-empty-clear" onClick={() => setFilter(EMPTY_FILTER)}>
                        Clear the filters
                      </button>
                    </td>
                  </tr>
                )}
                {!loading && shown.map((row) => (
                  <tr key={row.id} className={row.isActive ? undefined : 'row-retired'}>
                    <td>{row.name}</td>
                    <td className="master-desc">{row.description || ''}</td>
                    {isTypes && (
                      <td>
                        <label className="master-shared" title={row.isShared
                          ? `A ${row.name} can be linked to several assets at once.`
                          : `A ${row.name} belongs to one asset at a time — linking it `
                            + 'to another moves it.'}>
                          <input
                            type="checkbox"
                            checked={Boolean(row.isShared)}
                            disabled={busyId === row.id}
                            onChange={() => toggleShared(row)}
                          />
                          <span>{row.isShared ? 'Several assets' : 'One at a time'}</span>
                        </label>
                      </td>
                    )}
                    <td className="actions-cell">
                      <button
                        type="button"
                        className="icon-btn"
                        title="Edit"
                        aria-label="Edit"
                        onClick={() => openEdit(row)}
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        disabled={busyId === row.id}
                        title={row.isActive ? 'Retire — hide from the asset form' : 'Reactivate'}
                        aria-label={row.isActive ? 'Retire' : 'Reactivate'}
                        onClick={() => toggleActive(row)}
                      >
                        {row.isActive ? <EyeOff size={13} /> : <Eye size={13} />}
                      </button>
                      {isSuperadmin && (
                        <button
                          type="button"
                          className="icon-btn icon-btn-danger"
                          disabled={busyId === row.id || (row.inUse || 0) > 0}
                          title={(row.inUse || 0) > 0
                            ? `Used by ${row.inUse} asset(s) — retire it instead of deleting`
                            : 'Delete'}
                          aria-label="Delete"
                          onClick={() => handleDelete(row)}
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
          )}
        </>
      )}

      {modalOpen && spec && (
        <MasterOptionModal
          category={spec.key}
          label={spec.label}
          option={modalOption}
          onClose={() => { setModalOpen(false); setModalOption(null); }}
          onSaved={handleSaved}
        />
      )}

      {bulkOpen && spec && (
        <MasterBulkAdd
          category={spec.key}
          label={spec.label}
          plural={spec.plural}
          existingNames={existingNames}
          onClose={() => setBulkOpen(false)}
          onDone={handleBulkDone}
        />
      )}

      {uploadOpen && (
        <MasterWorkbookUpload
          categories={categories}
          onClose={() => setUploadOpen(false)}
          onDone={handleAllDone}
        />
      )}

      </div>
    </div>
  );
};

export default MasterDataPage;
