import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Calendar, CheckCircle2, ChevronDown, ChevronRight, Download, History, Layers, ListOrdered, Pencil,
  Plus, RotateCcw, Search, Trash2, Undo2, Upload, X,
} from 'lucide-react';
import api, { errorMessage } from '../api';
import Banner from '../components/Banner';
import DateInput from '../components/DateInput';
import RegisterToggle from '../components/RegisterToggle';
import StatusBadge from '../components/StatusBadge';
import { useAssets } from '../context/AssetsContext';
import { getDatePresets } from '../lib/datePresets';
import { formatDateTime, isStoredDate } from '../lib/dates';
import { RETIRED_LABELS } from '../lib/historyGroups';
import { useLongPress } from '../lib/longPress';
import { SOFTWARE, labelFor, pathOf } from '../lib/registers';
import { byKey, byKeyFor } from '../lib/schema';
import './ReportPage.css';
import './HistoryPage.css';

const PAGE_SIZE = 25;

const SEARCH_DEBOUNCE_MS = 300;

const ICONS = {
  created: Plus,
  imported: Upload,
  updated: Pencil,
  deleted: Trash2,
  restored: RotateCcw,
  verified: CheckCircle2,
  rejected: Undo2,
  discarded: Trash2,
};

const ACTION_LABELS = {
  created: 'Added',
  imported: 'Imported',
  updated: 'Edited',
  deleted: 'Deleted',
  restored: 'Restored',
  purged: 'Permanently deleted',
  verified: 'Verified',
  rejected: 'Sent back',
  discarded: 'Discarded',
};

const LINK_LABELS = {
  linkedPeripherals: 'Linked Peripherals', linkedAsset: 'Linked To', verification: 'Verification',
};

const fieldLabel = (key, register) => (key
  ? (byKeyFor(key, register)?.label || byKey(key)?.label || RETIRED_LABELS[key] || LINK_LABELS[key] || key)
  : '');

function filterFields(register) {
  const software = register === SOFTWARE;
  return [
    { key: 'assetId', label: labelFor('assetId', 'Asset ID', register), search: true },
    ...(software ? [] : [
      { key: 'type', label: byKeyFor('type', register)?.label || 'Type', search: true, values: true }]),
    { key: 'assetTag', label: labelFor('assetTag', byKeyFor('assetTag', register)?.label || 'Name', register), search: true },
    ...(software ? [] : [{ key: 'model', label: 'Model', search: true }]),
    { key: 'srl', label: labelFor('srl', 'Srl No.', register), search: true },
    { key: 'status', label: 'Status', search: true, values: true },
    { key: 'action', label: 'What happened', values: true },
    { key: 'value', label: 'Changed from / to', search: true },
    { key: 'actor', label: 'Changed by', search: true, values: true },
    { key: 'when', label: 'When', date: true },
  ];
}

const NO_PICKS = { type: [], status: [], action: [], actor: [] };

const CHANGE_PRESETS = [2, 3, 4, 5, 10];

const formatWhen = formatDateTime;

function summarise(row, register) {
  if (row.lastAction === 'updated') {
    return fieldLabel(row.lastField, register) || 'Edited';
  }
  return ACTION_LABELS[row.lastAction] || row.lastAction;
}

const HistoryPage = () => {
  const { registerHistory, meta, register, optionsFor } = useAssets();
  const navigate = useNavigate();

  const fields = useMemo(() => filterFields(register), [register]);
  const isSoftware = register === SOFTWARE;
  const typeLabel = fields.find((f) => f.key === 'type')?.label || 'Type';

  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [fieldKey, setFieldKey] = useState('');
  const [picks, setPicks] = useState(NO_PICKS);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [minChanges, setMinChanges] = useState(0);
  const [page, setPage] = useState(1);
  const [menu, setMenu] = useState(null);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const { bind: longPress, pressing, flash } = useLongPress();

  useEffect(() => { setSelected(new Set()); }, [register]);

  const barRef = useRef(null);
  const datePresets = useMemo(() => getDatePresets(), []);

  const requestRef = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => { setQuery(search); setPage(1); }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!menu) return undefined;
    const onDown = (e) => {
      if (barRef.current && !barRef.current.contains(e.target)) setMenu(null);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menu]);

  const field = fields.find((f) => f.key === fieldKey) || null;
  const searchIn = field?.search ? field.key : '';

  const filterParams = useMemo(() => ({
    q: query || undefined,
    in: (query && searchIn) || undefined,
    type: picks.type.length ? picks.type : undefined,
    status: picks.status.length ? picks.status : undefined,
    action: picks.action.length ? picks.action : undefined,
    actor: picks.actor.length ? picks.actor : undefined,
    from: from || undefined,
    to: to || undefined,
    minChanges: minChanges > 1 ? minChanges : undefined,
  }), [query, searchIn, picks, from, to, minChanges]);

  useEffect(() => {
    const ticket = ++requestRef.current;
    setLoading(true);
    registerHistory({
      ...filterParams,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    })
      .then((res) => {
        if (ticket !== requestRef.current) return;
        setData(res);
        setBanner(null);
      })
      .catch((err) => {
        if (ticket !== requestRef.current) return;
        setBanner({ text: errorMessage(err, 'Could not load the history.'), kind: 'error' });
      })
      .finally(() => {
        if (ticket === requestRef.current) setLoading(false);
      });
  }, [registerHistory, filterParams, page]);

  const items = data?.items || [];
  const total = data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const picked = Object.values(picks).some((list) => list.length);
  const filtered = Boolean(query || picked || from || to || minChanges > 1);

  const chooseMinChanges = (n) => {
    setMinChanges(Number.isFinite(n) && n > 1 ? Math.floor(n) : 0);
    setPage(1);
  };

  const pageIds = items.map((row) => row.assetPk);
  const pagePicked = pageIds.length > 0 && pageIds.every((id) => selected.has(id));

  const toggleRow = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const togglePage = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      pageIds.forEach((id) => (pagePicked ? next.delete(id) : next.add(id)));
      return next;
    });
  };

  const downloadReport = async () => {
    setDownloading(true);
    try {
      const endpoint = `/${pathOf(register)}/history/export`;
      const res = selected.size
        ? await api.post(endpoint, { ids: [...selected] }, { responseType: 'blob' })
        : await api.get(endpoint, {
          params: filterParams, paramsSerializer: { indexes: null }, responseType: 'blob',
        });
      const name = /filename="?([^";]+)"?/.exec(res.headers?.['content-disposition'] || '')?.[1]
        || `${pathOf(register)}-movement-history.xlsx`;
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      let text = errorMessage(err, 'Could not prepare the history report.');
      if (err.response?.data instanceof Blob) {
        try {
          const body = JSON.parse(await err.response.data.text());
          text = [].concat(body.detail || text).join(' ');
        } catch {  }
      }
      setBanner({ text, kind: 'error' });
    } finally {
      setDownloading(false);
    }
  };

  const valuesFor = (key) => {
    if (key === 'action') return (data?.actions || []).map((a) => ({ value: a, label: ACTION_LABELS[a] || a }));
    if (key === 'actor') return (data?.actors || []).map((a) => ({ value: a, label: a }));
    return (optionsFor(key) || []).map((v) => ({ value: v, label: v }));
  };

  const clearFilters = () => {
    setSearch(''); setQuery(''); setFieldKey(''); setPicks(NO_PICKS); setFrom(''); setTo('');
    setMinChanges(0);
    setMenu(null);
    setPage(1);
  };

  const chooseField = (key) => {
    setFieldKey(key);
    setMenu(null);
    setPage(1);
  };

  const togglePick = (key, value) => {
    setPicks((prev) => {
      const list = prev[key];
      return { ...prev, [key]: list.includes(value) ? list.filter((v) => v !== value) : [...list, value] };
    });
    setPage(1);
  };

  const setRange = (nextFrom, nextTo) => {
    setFrom(nextFrom);
    setTo(nextTo);
    setPage(1);
  };

  const pickLabel = (key, value) => (key === 'action' ? (ACTION_LABELS[value] || value) : value);
  const labelOf = (key) => fields.find((f) => f.key === key)?.label || key;

  const open = (row) => navigate(`/history/${encodeURIComponent(row.assetPk)}`);

  const fieldPicks = field?.values ? picks[field.key] : [];

  return (
    <div className="page-scroll history-page">
      <div className="page-card">
        <div className="page-header hist-header">
          <div>
            <h1><History size={19} /> History</h1>
          </div>
          <RegisterToggle size="sm" />
        </div>

      <Banner banner={banner} onDismiss={() => setBanner(null)} />

      <div className="report-filter-row hist-filter-row" ref={barRef}>
        {field?.date ? (
          <div className="report-date-range-wrap report-search-wrap">
            <Calendar size={14} className="report-search-icon" />
            <span className="report-date-label">From</span>
            <DateInput className="report-date-range-input" value={from}
              aria-label="Changed on or after"
              onChange={(v) => { if (v === '' || isStoredDate(v)) setRange(v, to); }} />
            <span className="report-date-label">To</span>
            <DateInput className="report-date-range-input" value={to}
              aria-label="Changed on or before"
              onChange={(v) => { if (v === '' || isStoredDate(v)) setRange(from, v); }} />
            {(from || to) && (
              <button type="button" className="report-search-clear" onClick={() => setRange('', '')}
                title="Clear date range" aria-label="Clear date range">
                <X size={13} />
              </button>
            )}
          </div>
        ) : (
          <div className="report-search-wrap">
            <Search size={14} className="report-search-icon" />
            <input
              type="text"
              className="report-search-input"
              placeholder={searchIn ? `Search ${field.label}…` : `Search a ${meta.one}, a value, a person…`}
              aria-label={searchIn ? `Search ${field.label}` : 'Search the history'}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button type="button" className="report-search-clear" onClick={() => setSearch('')}
                aria-label="Clear search">
                <X size={13} />
              </button>
            )}
          </div>
        )}

        <div className="filter-pill-wrap">
          <button
            type="button"
            className={`filter-pill${field ? ' active' : ''}`}
            onClick={() => setMenu(menu === 'field' ? null : 'field')}
            aria-haspopup="listbox"
            aria-expanded={menu === 'field'}
            title="Choose which field to filter on"
          >
            <Layers size={13} />
            <span>{field ? `Filter: ${field.label}` : 'Filter'}</span>
            <ChevronDown size={12} className="pill-caret" />
          </button>
          {menu === 'field' && (
            <div className="filter-pill-popover" role="listbox" aria-label="Filter on">
              <div className="pill-popover-header">Search in</div>
              <div className="pill-popover-list">
                <button type="button" role="option" aria-selected={!field}
                  className={`pill-popover-option${!field ? ' selected' : ''}`}
                  onClick={() => chooseField('')}>
                  All fields
                </button>
                {fields.map((f) => (
                  <button key={f.key} type="button" role="option" aria-selected={fieldKey === f.key}
                    className={`pill-popover-option${fieldKey === f.key ? ' selected' : ''}`}
                    onClick={() => chooseField(f.key)}>
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {field?.values && (
          <div className="filter-pill-wrap">
            <button
              type="button"
              className={`filter-pill${fieldPicks.length ? ' active' : ''}`}
              onClick={() => setMenu(menu === 'values' ? null : 'values')}
              aria-haspopup="listbox"
              aria-expanded={menu === 'values'}
              title={`Show only these ${field.label} values`}
            >
              <span>
                {fieldPicks.length === 1
                  ? pickLabel(field.key, fieldPicks[0])
                  : fieldPicks.length
                    ? `${field.label} (${fieldPicks.length})`
                    : `Any ${field.label}`}
              </span>
              <ChevronDown size={12} className="pill-caret" />
            </button>
            {menu === 'values' && (
              <div className="filter-pill-popover">
                <div className="pill-popover-header">{field.label}</div>
                <div className="pill-popover-list">
                  {valuesFor(field.key).length === 0 && (
                    <div className="pill-popover-empty">Nothing to choose from yet.</div>
                  )}
                  {valuesFor(field.key).map(({ value, label }) => (
                    <label key={value} className="pill-popover-item">
                      <input type="checkbox" checked={fieldPicks.includes(value)}
                        onChange={() => togglePick(field.key, value)} />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
                {fieldPicks.length > 0 && (
                  <button type="button" className="pill-popover-clear"
                    onClick={() => { setPicks((p) => ({ ...p, [field.key]: [] })); setPage(1); }}>
                    Clear {field.label.toLowerCase()} filter
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {field?.date && (
          <div className="filter-pill-wrap">
            <button
              type="button"
              className={`filter-pill${from || to ? ' active' : ''}`}
              onClick={() => setMenu(menu === 'range' ? null : 'range')}
              aria-haspopup="dialog"
              aria-expanded={menu === 'range'}
              title="Quick ranges for when the change was made"
            >
              <Calendar size={13} />
              <span>Quick Range</span>
              <ChevronDown size={12} className="pill-caret" />
            </button>
            {menu === 'range' && (
              <div className="filter-pill-popover date-range-popover">
                <div className="pill-popover-header">When it changed</div>
                <div className="date-range-presets-list">
                  {datePresets.map((preset) => (
                    <button key={preset.label} type="button" className="date-range-preset-item"
                      onClick={() => { setRange(preset.from, preset.to); setMenu(null); }}>
                      <span className="preset-label">{preset.label}</span>
                      <span className="preset-dates">{preset.from} → {preset.to}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="filter-pill-wrap">
          <button
            type="button"
            className={`filter-pill${minChanges > 1 ? ' active' : ''}`}
            onClick={() => setMenu(menu === 'changes' ? null : 'changes')}
            aria-haspopup="listbox"
            aria-expanded={menu === 'changes'}
            title="Show only records changed at least this many times"
          >
            <ListOrdered size={13} />
            <span>{minChanges > 1 ? `${minChanges}+ changes` : 'Changes'}</span>
            <ChevronDown size={12} className="pill-caret" />
          </button>
          {menu === 'changes' && (
            <div className="filter-pill-popover hist-changes-popover">
              <div className="pill-popover-header">Changed at least</div>
              <div className="pill-popover-list">
                <button type="button" className={`pill-popover-option${minChanges <= 1 ? ' selected' : ''}`}
                  onClick={() => { chooseMinChanges(0); setMenu(null); }}>
                  Any number of times
                </button>
                {CHANGE_PRESETS.map((n) => (
                  <button key={n} type="button"
                    className={`pill-popover-option${minChanges === n ? ' selected' : ''}`}
                    onClick={() => { chooseMinChanges(n); setMenu(null); }}>
                    {n} or more times
                  </button>
                ))}
              </div>
              <label className="hist-changes-custom">
                <span>Or type a number</span>
                <input
                  type="number"
                  min="2"
                  step="1"
                  className="field-input"
                  value={minChanges > 1 ? minChanges : ''}
                  placeholder="e.g. 4"
                  onChange={(e) => chooseMinChanges(parseInt(e.target.value, 10))}
                />
              </label>
            </div>
          )}
        </div>

        {filtered && (
          <button type="button" className="btn-clear-pill" onClick={clearFilters}
            title="Clear the search and every filter">
            <X size={12} /> Reset
          </button>
        )}

        <button
          type="button"
          className={`${selected.size ? 'btn-primary' : 'btn-secondary'} hist-download-btn`}
          onClick={downloadReport}
          disabled={downloading || (!selected.size && !loading && total === 0)}
          title={selected.size
            ? `Download the movement history of the ${selected.size} ticked — every change, when and by whom`
            : `Download the movement history of every ${meta.one} shown here (all pages) — every change, when and by whom`}
        >
          <Download size={14} />
          {downloading ? 'Preparing…'
            : selected.size ? `Download ${selected.size.toLocaleString('en-IN')} selected` : 'Download report'}
        </button>
      </div>

      {(picked || from || to || minChanges > 1) && (
        <div className="hist-chips">
          {Object.entries(picks).filter(([, list]) => list.length).map(([key, list]) => (
            <span key={key} className="hist-filter-chip">
              <span className="hist-filter-chip-key">{labelOf(key)}:</span>
              {list.map((v) => pickLabel(key, v)).join(', ')}
              <button type="button" aria-label={`Remove the ${labelOf(key)} filter`}
                onClick={() => { setPicks((p) => ({ ...p, [key]: [] })); setPage(1); }}>
                <X size={11} />
              </button>
            </span>
          ))}
          {(from || to) && (
            <span className="hist-filter-chip">
              <span className="hist-filter-chip-key">When:</span>
              {from && to ? `${from} → ${to}` : from ? `from ${from}` : `until ${to}`}
              <button type="button" aria-label="Remove the date filter" onClick={() => setRange('', '')}>
                <X size={11} />
              </button>
            </span>
          )}
          {minChanges > 1 && (
            <span className="hist-filter-chip">
              <span className="hist-filter-chip-key">Changes:</span>
              {minChanges} or more
              <button type="button" aria-label="Remove the changes filter" onClick={() => chooseMinChanges(0)}>
                <X size={11} />
              </button>
            </span>
          )}
        </div>
      )}

      <div className="hist-count">
        {loading && !data
          ? 'Loading…'
          : `${total.toLocaleString('en-IN')} ${total === 1 ? meta.one : meta.many}${filtered ? ' matching' : ' with recorded changes'}`}
        {selected.size > 0 && (
          <>
            {' · '}<strong>{selected.size.toLocaleString('en-IN')} selected</strong>{' '}
            <button type="button" className="hist-clear-selection" onClick={() => setSelected(new Set())}>
              Clear selection
            </button>
          </>
        )}
      </div>

      <div className={`data-table-wrap hist-table-wrap${loading ? ' is-loading' : ''}`}>
        <table className="data-table hist-table">
          <thead>
            <tr>
              <th className="hist-col-pick">
                <input
                  type="checkbox"
                  checked={pagePicked}
                  disabled={!pageIds.length}
                  onChange={togglePage}
                  aria-label={pagePicked ? 'Untick every row on this page' : 'Tick every row on this page'}
                  title={pagePicked ? 'Untick this page' : 'Tick every row on this page'}
                />
              </th>
              <th className="hist-col-id">{labelFor('assetId', 'Asset ID', register)}</th>
              {!isSoftware && <th>{typeLabel}</th>}
              <th>{isSoftware ? labelFor('assetTag', 'Asset Name', register) : 'Asset Name'}</th>
              {!isSoftware && <th>Model</th>}
              <th>Status</th>
              <th className="num-cell">Changes</th>
              <th>Latest change</th>
              <th>When</th>
              <th>By</th>
              <th aria-label="Open" />
            </tr>
          </thead>
          <tbody>
            {items.map((row) => {
              const Icon = ICONS[row.lastAction] || Pencil;
              return (
                <tr
                  key={row.assetPk}
                  {...longPress(row.assetPk, () => toggleRow(row.assetPk))}
                  className={`hist-tr longpress-row${row.isDeleted ? ' row-deleted' : ''}${selected.has(row.assetPk) ? ' row-selected' : ''}${pressing === row.assetPk ? ' row-pressing' : ''}${flash === row.assetPk && selected.has(row.assetPk) ? ' row-flash' : ''}`}
                  onClick={() => open(row)}
                  tabIndex={0}
                  role="link"
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(row); }
                  }}
                >
                  <td className="hist-col-pick" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selected.has(row.assetPk)}
                      onChange={() => toggleRow(row.assetPk)}
                      aria-label={`Select ${row.assetId || 'this record'}`}
                    />
                  </td>
                  <td className="hist-col-id">
                    <span className="hist-asset-id">{row.assetId || '—'}</span>
                    {row.recordedAssetId && row.recordedAssetId !== row.assetId && (
                      <span className="hist-asset-was">was {row.recordedAssetId}</span>
                    )}
                  </td>
                  {!isSoftware && <td className="hist-muted hist-nowrap">{row.type || '—'}</td>}
                  <td>{row.assetTag || <span className="hist-gone">no longer in the register</span>}</td>
                  {!isSoftware && <td className="hist-muted">{row.model || '—'}</td>}
                  <td>{row.status ? <StatusBadge status={row.status} /> : '—'}</td>
                  <td className="num-cell">{row.changes.toLocaleString('en-IN')}</td>
                  <td>
                    <span className={`hist-chip hist-chip-${row.lastAction}`}>
                      <Icon size={11} /> {summarise(row, register)}
                    </span>
                  </td>
                  <td className="hist-muted hist-nowrap">{formatWhen(row.lastAt)}</td>
                  <td className="hist-muted">{row.lastActor || '—'}</td>
                  <td className="hist-open"><ChevronRight size={15} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {!loading && !items.length && (
          <div className="hist-empty-state">
            {filtered ? (
              <>Nothing matches these filters.</>
            ) : (
              <>
                Nothing recorded yet. History starts from the first change after this
                was added, so a register that has not been touched since shows nothing
                here.
              </>
            )}
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="hist-pagination">
          <button type="button" onClick={() => setPage(1)} disabled={page <= 1}>First</button>
          <button type="button" onClick={() => setPage((p) => p - 1)} disabled={page <= 1}>
            Previous
          </button>
          <span>Page {page.toLocaleString('en-IN')} of {totalPages.toLocaleString('en-IN')}</span>
          <button type="button" onClick={() => setPage((p) => p + 1)} disabled={page >= totalPages}>
            Next
          </button>
          <button type="button" onClick={() => setPage(totalPages)} disabled={page >= totalPages}>
            Last
          </button>
        </div>
      )}
      </div>
    </div>
  );
};

export default HistoryPage;
