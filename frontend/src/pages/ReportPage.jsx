import { useEffect, useMemo, useState, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowDownToLine, Building2, Calendar, ChevronDown, Copy, Cpu, Download, FileSpreadsheet,
  HardDrive, Hash, History, IndianRupee, Keyboard, Laptop, Layers,
  Monitor, Mouse, Package, Paperclip, Pencil, Printer,
  QrCode, Repeat2, RotateCcw, ScanLine, Search, Server, Smartphone, Tablet,
  Tag, Trash2, TrendingDown, Upload, User, UserPlus, SlidersHorizontal, X
} from 'lucide-react';
import api, { errorMessage } from '../api';
import AssetModal from '../components/AssetModal';
import Banner from '../components/Banner';
import BulkEditModal from '../components/BulkEditModal';
import DateInput from '../components/DateInput';
import MultiHistoryModal from '../components/MultiHistoryModal';
import MultiSelectFilter from '../components/MultiSelectFilter';
import PermanentDeleteModal from '../components/PermanentDeleteModal';
import QrCodesModal from '../components/QrCodesModal';
import RegisterToggle from '../components/RegisterToggle';
import RestoreModal from '../components/RestoreModal';
import SoftwareMoveModal from '../components/SoftwareMoveModal';
import { isInStock as isInStockStatus } from '../lib/inventory';
import ScanSerialsModal from '../components/ScanSerialsModal';
import StatusBadge from '../components/StatusBadge';
import { useAssets } from '../context/AssetsContext';
import { useAuth } from '../context/AuthContext';
import { useMasters } from '../context/MastersContext';
import { getDatePresets } from '../lib/datePresets';
import { formatDate, isStoredDate, istParts } from '../lib/dates';
import { exportCSV, exportXLSX } from '../lib/exporters';
import { NOT_RECORDED, isNotRecorded, joinRecorded } from '../lib/notRecorded';
import {
  NORMAL, ariaSort, nextSort, sortGlyph, sortHint, sortRows,
} from '../lib/reportSort';
import { useLongPress } from '../lib/longPress';
import { ASSET, SOFTWARE } from '../lib/registers';
import {
  byKey, cloneAsset, COLUMNS, columnsFor, isNumericColumn, reportColumnsFor,
} from '../lib/schema';
import './ReportPage.css';

const RUPEES = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
function formatPrice(value) {
  const n = Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(n) && String(value).trim() !== '' ? `₹ ${RUPEES.format(n)}` : value;
}
function daysUntil(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const today = istParts();
  const start = Date.UTC(today.y, today.m - 1, today.d);
  return Math.round((Date.UTC(y, m - 1, d) - start) / 86400000);
}
const RENEWAL_SOON_DAYS = 30;

function parseDateString(str) {
  if (!str) return null;
  const s = str.trim();
  const ymd = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (ymd) {
    return `${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}`;
  }
  const dmy = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (dmy) {
    return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  }
  return null;
}

function parseDateRangeString(str) {
  if (!str) return null;
  const s = str.trim();
  const rangeMatch = s.match(/^([0-9\-/.]+)\s+(?:to|-|\.\.)\s+([0-9\-/.]+)$/i);
  if (rangeMatch) {
    const from = parseDateString(rangeMatch[1]);
    const to = parseDateString(rangeMatch[2]);
    if (from && to) return { from, to };
  }
  const afterMatch = s.match(/^(?:after|from|>=|>)\s*([0-9\-/.]+)$/i);
  if (afterMatch) {
    const from = parseDateString(afterMatch[1]);
    if (from) return { from, to: '' };
  }
  const beforeMatch = s.match(/^(?:before|until|to|<=|<)\s*([0-9\-/.]+)$/i);
  if (beforeMatch) {
    const to = parseDateString(beforeMatch[1]);
    if (to) return { from: '', to };
  }
  return null;
}

function formatSiteWithFloor(row) {
  return joinRecorded([row.site, row.floor]);
}

function buildInitialFilters() {
  const f = {};
  COLUMNS.forEach((col) => {
    if (col.filterType === 'select') f[col.key] = { values: [] };
    else if (col.filterType === 'date') f[col.key] = { from: '', to: '' };
    else if (col.filterType === 'number') f[col.key] = { min: '', max: '' };
    else f[col.key] = { value: '' };
  });
  return f;
}

function getDeviceIcon(type) {
  const t = (type || '').toUpperCase();
  if (t.includes('LAPTOP') || t.includes('MACBOOK')) return Laptop;
  if (t.includes('MONITOR') || t.includes('SCREEN') || t.includes('DISPLAY')) return Monitor;
  if (t.includes('MOUSE')) return Mouse;
  if (t.includes('KEYBOARD')) return Keyboard;
  if (t.includes('PRINTER')) return Printer;
  if (t.includes('SERVER')) return Server;
  if (t.includes('MOBILE') || t.includes('PHONE')) return Smartphone;
  if (t.includes('TABLET') || t.includes('IPAD')) return Tablet;
  if (t.includes('DESKTOP') || t.includes('PC')) return Cpu;
  return HardDrive;
}

function getColumnHeaderIcon(key) {
  if (key === 'assetTag' || key === 'model') return Laptop;
  if (key === 'user') return User;
  if (key === 'type') return Layers;
  if (key === 'srl' || key === 'assetId' || key === 'sapId') return Hash;
  if (key === 'poNo' || key === 'version') return Tag;
  if (key === 'dop' || key === 'warrantyEnd' || key === 'insuranceEnd' || key === 'assignedDate') return Calendar;
  if (key === 'status' || key === 'availability') return TrendingDown;
  if (key === 'quantity') return Hash;
  if (key === 'price') return IndianRupee;
  if (key === 'vendor') return Building2;
  return null;
}

function getUserInitials(name) {
  if (!name || name === 'N/A' || name === '—') return '·';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function getAvatarColor(name) {
  const colors = [
    '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#6366f1'
  ];
  let hash = 0;
  for (let i = 0; i < (name || '').length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

const ReportPage = () => {
  const {
    assets, loading, deleteAssets, filterOptionsFor, optionsFor, register, meta,
  } = useAssets();
  const { isMastered } = useMasters();
  const { isAdmin, isSuperadmin, canWrite, canEdit } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const reportColumns = useMemo(() => reportColumnsFor(register), [register]);
  const isSoftware = register === SOFTWARE;
  const searchColumns = useMemo(() => {
    const own = register === SOFTWARE ? columnsFor(register) : COLUMNS;
    return own.some((c) => c.key === 'assetId') ? own : [...own, byKey('assetId')];
  }, [register]);

  const fromAgeBand = location.state?.ageBand || null;
  const [filters, setFilters] = useState(() => {
    const initial = buildInitialFilters();
    if (fromAgeBand && initial.dop) {
      initial.dop = { from: fromAgeBand.from || '', to: fromAgeBand.to || '' };
      Object.entries(location.state?.columnFilters || {}).forEach(([key, values]) => {
        if (initial[key]?.values && values?.length) initial[key] = { values };
      });
    }
    return initial;
  });
  const [search, setSearch] = useState(() => location.state?.search || '');
  const [sort, setSort] = useState(NORMAL);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [editing, setEditing] = useState(null);
  const [editFocus, setEditFocus] = useState(null);
  const [banner, setBanner] = useState(() => (fromAgeBand ? {
    kind: 'info',
    text: `From the Dashboard's age chart: ${meta.label.toLowerCase()} aged ${fromAgeBand.label}, `
      + (fromAgeBand.from
        ? `bought ${fromAgeBand.from} to ${fromAgeBand.to}.`
        : `bought on or before ${fromAgeBand.to}.`)
      + ' Reset clears it.',
  } : null));
  const [selected, setSelected] = useState(() => new Set());
  const { bind: longPress, pressing, flash } = useLongPress();
  const [scanning, setScanning] = useState(null);
  const [bulkEditing, setBulkEditing] = useState(null);
  const [qrIds, setQrIds] = useState(null);
  const [historyRecords, setHistoryRecords] = useState(null);
  const [purging, setPurging] = useState(null);
  const [restoring, setRestoring] = useState(null);
  const [moving, setMoving] = useState(null);

  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [searchField, setSearchField] = useState(() => (fromAgeBand ? 'dop' : ''));
  const [fieldMenuOpen, setFieldMenuOpen] = useState(false);
  const [valueMenuOpen, setValueMenuOpen] = useState(false);
  const [dateRangeMenuOpen, setDateRangeMenuOpen] = useState(false);
  const [notifyMode, setNotifyMode] = useState('off');
  useEffect(() => {
    let live = true;
    api.get('/notifications/mode')
      .then((res) => { if (live) setNotifyMode(res.data?.mode || 'off'); })
      .catch(() => {  });
    return () => { live = false; };
  }, []);
  const exportRef = useRef(null);
  const fieldRef = useRef(null);
  const valueRef = useRef(null);
  const dateRangeRef = useRef(null);
  const datePresets = useMemo(() => getDatePresets(), []);

  const fromAssistant = location.state?.assistantReport || null;
  const [idFilter, setIdFilter] = useState(null);
  const [seenAssistant, setSeenAssistant] = useState(null);
  if (fromAssistant && fromAssistant !== seenAssistant) {
    setSeenAssistant(fromAssistant);
    setIdFilter(new Set(fromAssistant.ids || []));
    setFilters(buildInitialFilters());
    setSearch('');
    setSearchField('');
    setPage(1);
    const n = (fromAssistant.ids || []).length;
    setBanner({
      kind: 'info',
      text: `From the assistant: ${fromAssistant.title || 'report'} — ${n} ${n === 1 ? meta.one : meta.many}. Reset clears it.`,
    });
  }

  useEffect(() => {
    const handleOutside = (e) => {
      if (exportRef.current && !exportRef.current.contains(e.target)) {
        setExportMenuOpen(false);
      }
      if (fieldRef.current && !fieldRef.current.contains(e.target)) {
        setFieldMenuOpen(false);
      }
      if (valueRef.current && !valueRef.current.contains(e.target)) {
        setValueMenuOpen(false);
      }
      if (dateRangeRef.current && !dateRangeRef.current.contains(e.target)) {
        setDateRangeMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  useEffect(() => {
    if (location.state?.search || location.state?.ageBand || location.state?.assistantReport) {
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location.pathname, location.state?.search, location.state?.ageBand,
    location.state?.assistantReport, navigate]);

  const setFilter = (key, patch) => {
    setFilters((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
    setPage(1);
  };

  const clearFilters = () => {
    setFilters(buildInitialFilters());
    setSearch('');
    setSearchField('');
    setDateRangeMenuOpen(false);
    setIdFilter(null);
    setPage(1);
  };

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (search.trim()) count++;
    if (idFilter) count++;
    Object.values(filters).forEach((f) => {
      if (f.value) count++;
      if (f.values && f.values.length > 0) count++;
      if (f.min || f.max) count++;
      if (f.from || f.to) count++;
    });
    return count;
  }, [filters, search, idFilter]);

  const openRecord = (e, row) => {
    if (e.target.closest('.actions-cell') || e.target.closest('.assign-link-btn')) return;
    if (window.getSelection?.()?.toString()) return;
    navigate(`/report/${register}/${encodeURIComponent(row.id)}`);
  };

  const toggleSort = (key) => setSort((current) => nextSort(current, key));

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const searched = searchField ? searchColumns.filter((col) => col.key === searchField) : searchColumns;
    const dateRangeQuery = parseDateRangeString(q);
    const dateColumns = searchColumns.filter((col) => col.filterType === 'date');

    return assets.filter((r) => {
      if (idFilter && !idFilter.has(r.id)) return false;
      if (q) {
        if (dateRangeQuery) {
          const targetDateCols = searchField
            ? searched.filter((col) => col.filterType === 'date')
            : dateColumns;
          const hit = targetDateCols.some((col) => {
            const rawV = (r[col.key] ?? '').toString().trim();
            if (!rawV) return false;
            const v = /^\d{4}-\d{2}-\d{2}$/.test(rawV) ? rawV : (parseDateString(rawV) || rawV);
            if (dateRangeQuery.from && v < dateRangeQuery.from) return false;
            if (dateRangeQuery.to && v > dateRangeQuery.to) return false;
            return true;
          });
          if (!hit) return false;
        } else {
          const hit = searched.some((col) => (r[col.key] ?? '').toString().toLowerCase().includes(q));
          if (!hit) return false;
        }
      }
      return searchColumns.every((col) => {
        const f = filters[col.key];
        const rawV = (r[col.key] ?? '').toString().trim();
        const v = col.filterType === 'date' && rawV && !/^\d{4}-\d{2}-\d{2}$/.test(rawV)
          ? (parseDateString(rawV) || rawV)
          : rawV;

        if (col.filterType === 'text') {
          return !f.value || v.toLowerCase().includes(f.value.toLowerCase());
        }
        if (col.filterType === 'select') {
          return !f.values.length || f.values.includes(v);
        }
        if (col.filterType === 'number') {
          const n = parseFloat(v);
          if (f.min !== '' && (Number.isNaN(n) || n < parseFloat(f.min))) return false;
          if (f.max !== '' && (Number.isNaN(n) || n > parseFloat(f.max))) return false;
          return true;
        }
        if (col.filterType === 'date') {
          if (!v) return !f.from && !f.to;
          if (f.from && v < f.from) return false;
          if (f.to && v > f.to) return false;
          return true;
        }
        return true;
      });
    });
  }, [assets, filters, search, searchField, idFilter, searchColumns]);

  const sorted = useMemo(() => sortRows(filtered, sort), [filtered, sort]);

  const totalPages = pageSize === 'all' ? 1 : Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = pageSize === 'all'
    ? sorted
    : sorted.slice((safePage - 1) * pageSize, safePage * pageSize);

  const startIdx = sorted.length === 0 ? 0 : (pageSize === 'all' ? 1 : (safePage - 1) * pageSize + 1);
  const endIdx = pageSize === 'all' ? sorted.length : Math.min(safePage * pageSize, sorted.length);

  const toggleRow = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const pageAllSelected = pageRows.length > 0 && pageRows.every((r) => selected.has(r.id));

  const togglePage = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (pageAllSelected) pageRows.forEach((r) => next.delete(r.id));
      else pageRows.forEach((r) => next.add(r.id));
      return next;
    });
  };

  const selectAllMatching = () => setSelected(new Set(sorted.map((r) => r.id)));
  const clearSelection = () => setSelected(new Set());

  const startScan = () => {
    const queue = sorted.filter((r) => selected.has(r.id));
    if (queue.length) setScanning(queue);
  };

  const finishScan = ({ saved, skipped }) => {
    setScanning(null);
    clearSelection();
    if (saved || skipped) {
      setBanner({
        text: `Saved ${saved.toLocaleString('en-IN')} serial number(s)`
          + (skipped ? `, skipped ${skipped.toLocaleString('en-IN')}.` : '.'),
        kind: saved ? 'success' : 'info',
      });
    }
  };

  const handleClone = (row) => {
    navigate('/data-entry', { state: { cloneValues: cloneAsset(row, register) } });
  };

  const handleBulkDelete = async () => {
    const chosen = sorted.filter((r) => selected.has(r.id));
    const isSold = (r) => /sold/i.test(String(r.status || ''));
    const soldCount = chosen.filter((r) => !r.isDeleted && isSold(r)).length;
    const ids = chosen.filter((r) => !isSold(r) || r.isDeleted).map((r) => r.id);
    const live = chosen.filter((r) => !r.isDeleted && !isSold(r));
    if (!chosen.length) return;

    if (!live.length) {
      setBanner({
        text: soldCount
          ? `The selected ${soldCount === 1 ? meta.one : meta.many} ${soldCount === 1 ? 'was' : 'were'} sold, `
            + 'and a sold record cannot be scrapped. Nothing was changed.'
          : `Every selected ${meta.one} is already deleted. Nothing was changed.`,
        kind: 'error',
      });
      return;
    }
    const soldNote = soldCount
      ? `\n\n${soldCount} sold ${soldCount === 1 ? meta.one : meta.many} in the selection `
        + `${soldCount === 1 ? 'is' : 'are'} left out — a sold record cannot be scrapped.`
      : '';

    const what = live.length === 1
      ? `"${live[0].assetTag || live[0].model}" (${live[0].assetId})`
      : `${live.length.toLocaleString('en-IN')} ${meta.label.toLowerCase()}`;
    const undo = isSuperadmin
      ? 'each one can be restored from its own row.'
      : 'but only a superadmin can restore a scrapped record.';

    let reason = '';
    if (notifyMode === 'approve') {
      const answer = window.prompt(
        `Scrap ${what}?${soldNote}\n\nThis needs the IT head's approval. They will be emailed, and `
        + 'nothing is scrapped until they approve. Give a reason for them to read:',
        '',
      );
      if (answer === null) return;
      reason = answer.trim();
    } else {
      const message = `Delete ${what}?\n\n`
        + `The record${live.length === 1 ? ' is' : 's are'} kept in the register and marked `
        + `INACTIVE — nothing is erased, ${undo}`
        + soldNote
        + (notifyMode === 'inform' ? '\n\nThe IT head will be emailed about it.' : '');
      if (!window.confirm(message)) return;
    }

    try {
      const res = await deleteAssets(ids, reason);
      if (res.approvalRequested) {
        setBanner({
          text: `Sent to the IT head for approval: scrap ${res.approvalRequested.count.toLocaleString('en-IN')} `
            + `${meta.one}(s). Nothing is scrapped yet, and ${res.approvalRequested.count === 1 ? 'it is' : 'they are'} `
            + 'locked until the IT head decides. '
            + (isSuperadmin ? 'You can withdraw the request on Master Data > Notifications.'
              : 'A superadmin can withdraw the request.'),
          kind: 'info',
        });
        clearSelection();
        return;
      }
      const parts = [`${res.deleted.toLocaleString('en-IN')} ${meta.one}(s) deleted`];
      if (res.alreadyDeleted) parts.push(`${res.alreadyDeleted} already were`);
      if (res.skippedSold) parts.push(`${res.skippedSold} sold — not scrapped`);
      if (res.notFound) parts.push(`${res.notFound} no longer in the register`);
      setBanner({
        text: `${parts.join(', ')}. `
          + (isSuperadmin
            ? 'Restore any of them from its own row if that was a mistake.'
            : 'If that was a mistake, a superadmin can restore them.'),
        kind: 'success',
      });
      clearSelection();
    } catch (err) {
      setBanner({ text: errorMessage(err, `Could not delete the selected ${meta.many}.`), kind: 'error' });
    }
  };

  const handleRestored = (message) => {
    setRestoring(null);
    setBanner({ text: message, kind: 'success' });
  };

  const finishBulkEdit = (result) => {
    setBulkEditing(null);
    clearSelection();
    if (result.approvalRequested) {
      setBanner({
        text: `Sent to the IT head for approval: mark ${result.approvalRequested.count.toLocaleString('en-IN')} `
          + `${meta.one}(s) as sold. Nothing has changed yet; they are locked until the IT head decides.`,
        kind: 'info',
      });
      return;
    }
    const parts = [`${result.updated.toLocaleString('en-IN')} asset(s) updated`];
    if (result.unchanged) parts.push(`${result.unchanged} already had these values`);
    if (result.skippedDeleted) parts.push(`${result.skippedDeleted} deleted asset(s) skipped`);
    if (result.notFound) parts.push(`${result.notFound} no longer in the register`);
    setBanner({ text: `${parts.join(', ')}.`, kind: result.updated ? 'success' : 'info' });
  };

  const renderFilterControl = (col) => {
    const f = filters[col.key];

    if (col.filterType === 'text') {
      return (
        <input
          type="text"
          className="col-filter-text"
          placeholder="Filter…"
          value={f.value}
          onChange={(e) => setFilter(col.key, { value: e.target.value })}
        />
      );
    }
    if (col.filterType === 'number') {
      return (
        <>
          <input
            type="number"
            className="col-filter-num"
            placeholder="Min"
            value={f.min}
            onChange={(e) => setFilter(col.key, { min: e.target.value })}
          />
          <input
            type="number"
            className="col-filter-num"
            placeholder="Max"
            value={f.max}
            onChange={(e) => setFilter(col.key, { max: e.target.value })}
          />
        </>
      );
    }
    if (col.filterType === 'date') {
      return (
        <div className="col-filter-date-group">
          <DateInput
            className="col-filter-date"
            title={`From date for ${col.label}`}
            aria-label={`From date for ${col.label}`}
            value={f.from}
            onChange={(v) => { if (v === '' || isStoredDate(v)) setFilter(col.key, { from: v }); }}
          />
          <DateInput
            className="col-filter-date"
            title={`To date for ${col.label}`}
            aria-label={`To date for ${col.label}`}
            value={f.to}
            onChange={(v) => { if (v === '' || isStoredDate(v)) setFilter(col.key, { to: v }); }}
          />
        </div>
      );
    }
    return (
      <MultiSelectFilter
        options={filterOptionsFor(col.key, f.values)}
        selected={f.values}
        onChange={(values) => setFilter(col.key, { values })}
      />
    );
  };

  const fieldOptions = reportColumns;
  const fieldCol = searchField ? reportColumns.find((c) => c.key === searchField) : null;
  const isDateField = Boolean(fieldCol && fieldCol.filterType === 'date');
  const dateRange = isDateField ? (filters[fieldCol.key] || { from: '', to: '' }) : { from: '', to: '' };
  const hasDateRange = Boolean(dateRange.from || dateRange.to);

  const fieldHasMasters = Boolean(fieldCol && isMastered(fieldCol.key, register)
    && fieldCol.filterType === 'select' && filters[fieldCol.key]);
  const fieldValues = useMemo(
    () => (fieldHasMasters ? optionsFor(fieldCol.key) : []),
    [fieldHasMasters, fieldCol, optionsFor],
  );
  const pickedValues = fieldHasMasters ? filters[fieldCol.key].values : [];

  const chooseField = (key) => {
    if (fieldCol && fieldHasMasters && key !== fieldCol.key) {
      setFilter(fieldCol.key, { values: [] });
    }
    if (fieldCol && fieldCol.filterType === 'date' && key !== fieldCol.key) {
      setFilter(fieldCol.key, { from: '', to: '' });
    }
    const nextCol = key ? reportColumns.find((c) => c.key === key) : null;
    if (nextCol && nextCol.filterType === 'date') {
      if (search.trim()) {
        const parsedRange = parseDateRangeString(search);
        if (parsedRange) {
          setFilter(nextCol.key, { from: parsedRange.from || '', to: parsedRange.to || '' });
        } else {
          const parsedSingle = parseDateString(search);
          if (parsedSingle) {
            setFilter(nextCol.key, { from: parsedSingle, to: '' });
          }
        }
      }
      setSearch('');
    }
    setSearchField(key);
    setFieldMenuOpen(false);
    setValueMenuOpen(false);
    setDateRangeMenuOpen(false);
    setPage(1);
  };

  const toggleValue = (value) => {
    const next = pickedValues.includes(value)
      ? pickedValues.filter((v) => v !== value)
      : [...pickedValues, value];
    setFilter(fieldCol.key, { values: next });
  };

  return (
    <div className="page-scroll">
      <div className="page-card report-card">
        <div className="report-card-top">
          <div className="report-title-group">
            <h1 className="report-main-title">{meta.label}</h1>
            <div className="report-subtitle">
              {sorted.length.toLocaleString('en-IN')} total registered items
            </div>
          </div>

          <div className="report-actions-group">
            {register === ASSET && (
              <button
                type="button"
                className="btn-outline-action btn-outline-labelled"
                onClick={() => navigate('/report/new-vs-replaced')}
                title={`New vs replaced ${meta.label.toLowerCase()}, with the procurement trend`}
              >
                <Repeat2 size={16} />
                <span>New vs Replaced</span>
              </button>
            )}

            {canWrite && (
              <button
                type="button"
                className="btn-outline-action"
                onClick={() => navigate('/data-entry')}
                title={`Import ${meta.many} (CSV / Excel)`}
                aria-label={`Import ${meta.many}`}
              >
                <Upload size={16} />
              </button>
            )}

            <div className="export-dropdown-wrap" ref={exportRef}>
              <button
                type="button"
                className="btn-outline-action"
                onClick={() => setExportMenuOpen(!exportMenuOpen)}
                title="Export filtered records"
                aria-label="Export records"
              >
                <Download size={16} />
              </button>
              {exportMenuOpen && (
                <div className="export-menu-popover">
                  <button
                    type="button"
                    className="export-menu-item"
                    onClick={() => { setExportMenuOpen(false); exportCSV(sorted, register); }}
                  >
                    <FileSpreadsheet size={14} /> CSV
                  </button>
                  <button
                    type="button"
                    className="export-menu-item"
                    onClick={() => { setExportMenuOpen(false); exportXLSX(sorted, register); }}
                  >
                    <FileSpreadsheet size={14} /> Excel
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <Banner banner={banner} onDismiss={() => setBanner(null)} />

        <div className="report-filter-row">
          {isDateField ? (
            <div className="report-search-wrap report-date-range-wrap">
              <Calendar size={14} className="report-search-icon" />
              <span className="report-date-label">From</span>
              <DateInput
                className="report-date-range-input"
                title={`From date (${fieldCol.label})`}
                aria-label={`From date (${fieldCol.label})`}
                value={filters[fieldCol.key]?.from || ''}
                onChange={(v) => {
                  if (v !== '' && !isStoredDate(v)) return;
                  setFilter(fieldCol.key, { from: v });
                  setPage(1);
                }}
              />
              <span className="report-date-label">To</span>
              <DateInput
                className="report-date-range-input"
                title={`To date (${fieldCol.label})`}
                aria-label={`To date (${fieldCol.label})`}
                value={filters[fieldCol.key]?.to || ''}
                onChange={(v) => {
                  if (v !== '' && !isStoredDate(v)) return;
                  setFilter(fieldCol.key, { to: v });
                  setPage(1);
                }}
              />
              {(filters[fieldCol.key]?.from || filters[fieldCol.key]?.to) && (
                <button
                  type="button"
                  className="report-search-clear"
                  onClick={() => {
                    setFilter(fieldCol.key, { from: '', to: '' });
                    setPage(1);
                  }}
                  title="Clear date range"
                  aria-label="Clear date range"
                >
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
                placeholder={fieldCol ? `Search ${fieldCol.label}…`
                  : isSoftware ? 'Search software, versions, serials, vendors...'
                    : 'Search assets, serials, staff...'}
                aria-label={fieldCol ? `Search ${fieldCol.label}` : 'Search every field'}
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              />
              {search && (
                <button
                  type="button"
                  className="report-search-clear"
                  onClick={() => setSearch('')}
                  aria-label="Clear search"
                >
                  <X size={13} />
                </button>
              )}
            </div>
          )}

          <button
            type="button"
            className={`filter-pill${showAdvancedFilters || activeFilterCount > 0 ? ' active' : ''}`}
            onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
            title="Toggle per-column filters"
          >
            <SlidersHorizontal size={13} />
            <span>Advance</span>
          </button>

          <div className="filter-pill-wrap" ref={fieldRef}>
            <button
              type="button"
              className={`filter-pill${searchField ? ' active' : ''}`}
              onClick={() => { setFieldMenuOpen(!fieldMenuOpen); setValueMenuOpen(false); }}
              aria-haspopup="listbox"
              aria-expanded={fieldMenuOpen}
              title="Choose which field the search box searches"
            >
              <Layers size={13} />
              <span>{fieldCol ? `Filter: ${fieldCol.label}` : 'Filter'}</span>
              <ChevronDown size={12} className="pill-caret" />
            </button>
            {fieldMenuOpen && (
              <div className="filter-pill-popover" role="listbox" aria-label="Search in">
                <div className="pill-popover-header">Search in</div>
                <div className="pill-popover-list">
                  <button
                    type="button"
                    role="option"
                    aria-selected={!searchField}
                    className={`pill-popover-option${!searchField ? ' selected' : ''}`}
                    onClick={() => chooseField('')}
                  >
                    All fields
                  </button>
                  {fieldOptions.map((col) => (
                    <button
                      key={col.key}
                      type="button"
                      role="option"
                      aria-selected={searchField === col.key}
                      className={`pill-popover-option${searchField === col.key ? ' selected' : ''}`}
                      onClick={() => chooseField(col.key)}
                    >
                      {col.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {fieldHasMasters && (
            <div className="filter-pill-wrap" ref={valueRef}>
              <button
                type="button"
                className={`filter-pill${pickedValues.length ? ' active' : ''}`}
                onClick={() => { setValueMenuOpen(!valueMenuOpen); setFieldMenuOpen(false); }}
                aria-haspopup="listbox"
                aria-expanded={valueMenuOpen}
                title={`Show only these ${fieldCol.label} values`}
              >
                <span>
                  {pickedValues.length === 1
                    ? pickedValues[0]
                    : pickedValues.length
                      ? `${fieldCol.label} (${pickedValues.length})`
                      : `Any ${fieldCol.label}`}
                </span>
                <ChevronDown size={12} className="pill-caret" />
              </button>
              {valueMenuOpen && (
                <div className="filter-pill-popover">
                  <div className="pill-popover-header">{fieldCol.label}</div>
                  <div className="pill-popover-list">
                    {fieldValues.length === 0 && (
                      <div className="pill-popover-empty">No values in Master Data yet.</div>
                    )}
                    {fieldValues.map((value) => (
                      <label key={value} className="pill-popover-item">
                        <input
                          type="checkbox"
                          checked={pickedValues.includes(value)}
                          onChange={() => toggleValue(value)}
                        />
                        <span>{value}</span>
                      </label>
                    ))}
                  </div>
                  {pickedValues.length > 0 && (
                    <button
                      type="button"
                      className="pill-popover-clear"
                      onClick={() => setFilter(fieldCol.key, { values: [] })}
                    >
                      Clear {fieldCol.label.toLowerCase()} filter
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {isDateField && (
            <div className="filter-pill-wrap" ref={dateRangeRef}>
              <button
                type="button"
                className={`filter-pill${hasDateRange ? ' active' : ''}`}
                onClick={() => {
                  setDateRangeMenuOpen(!dateRangeMenuOpen);
                  setFieldMenuOpen(false);
                  setValueMenuOpen(false);
                }}
                aria-haspopup="dialog"
                aria-expanded={dateRangeMenuOpen}
                title={`Quick range presets for ${fieldCol.label}`}
              >
                <Calendar size={13} />
                <span>
                  {filters[fieldCol.key]?.from && filters[fieldCol.key]?.to
                    ? `${filters[fieldCol.key].from} → ${filters[fieldCol.key].to}`
                    : filters[fieldCol.key]?.from
                      ? `From ${filters[fieldCol.key].from}`
                      : filters[fieldCol.key]?.to
                        ? `Until ${filters[fieldCol.key].to}`
                        : 'Quick Range'}
                </span>
                <ChevronDown size={12} className="pill-caret" />
              </button>

              {dateRangeMenuOpen && (
                <div className="filter-pill-popover date-range-popover">
                  <div className="pill-popover-header">
                    <span>{fieldCol.label} Presets</span>
                    {hasDateRange && (
                      <button
                        type="button"
                        className="pill-popover-clear"
                        onClick={() => {
                          setFilter(fieldCol.key, { from: '', to: '' });
                          setPage(1);
                        }}
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  <div className="date-range-presets-list">
                    {datePresets.map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        className="date-range-preset-item"
                        onClick={() => {
                          setFilter(fieldCol.key, { from: preset.from, to: preset.to });
                          setDateRangeMenuOpen(false);
                          setPage(1);
                        }}
                      >
                        <span className="preset-label">{preset.label}</span>
                        <span className="preset-dates">{preset.from} → {preset.to}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeFilterCount > 0 && (
            <button
              type="button"
              className="btn-clear-pill"
              onClick={clearFilters}
              title="Reset all active filters"
            >
              <X size={12} /> Reset
            </button>
          )}

          <div className="report-filter-right">
            <RegisterToggle size="sm" />
          </div>
        </div>

        {selected.size > 0 && (
          <div className="bulk-bar">
            <span className="bulk-count">{selected.size.toLocaleString('en-IN')} selected</span>
            {selected.size < sorted.length && (
              <button type="button" className="bulk-link" onClick={selectAllMatching}>
                Select all {sorted.length.toLocaleString('en-IN')} matching
              </button>
            )}
            <button type="button" className="bulk-link" onClick={clearSelection}>Clear</button>
            <div className="bulk-actions">
              {canWrite && (
                <button
                  type="button"
                  className="btn-secondary bulk-edit-btn"
                  onClick={() => setBulkEditing([...selected])}
                >
                  <Layers size={14} /> Edit selected
                </button>
              )}
              <button
                type="button"
                className="btn-secondary bulk-qr-btn"
                title="QR labels for the selected assets"
                onClick={() => setQrIds(sorted.filter((r) => selected.has(r.id)).map((r) => r.id))}
              >
                <QrCode size={14} /> QR codes
              </button>
              <button
                type="button"
                className="btn-secondary bulk-history-btn"
                title={`Movement history of the selected ${meta.many}, one at a time`}
                onClick={() => setHistoryRecords(sorted.filter((r) => selected.has(r.id)))}
              >
                <History size={14} /> History
              </button>
              <button type="button" className="btn-primary bulk-scan-btn" onClick={startScan}>
                <ScanLine size={14} /> Scan serial numbers
              </button>
              {isAdmin && (
                <button
                  type="button"
                  className="btn-danger bulk-delete-btn"
                  title={`Scrap the selected ${meta.many}`}
                  onClick={handleBulkDelete}
                >
                  <Trash2 size={14} /> Scrap
                </button>
              )}
            </div>
          </div>
        )}

        <div className="data-table-wrap report-table-wrap">
          <table className="data-table report-table">
            <thead>
              <tr>
                <th className="actions-col">
                  <label className="row-select" title="Select every asset on this page">
                    <input
                      type="checkbox"
                      checked={pageAllSelected}
                      onChange={togglePage}
                      aria-label="Select all on this page"
                    />
                  </label>
                  <span>Actions</span>
                </th>

                {reportColumns.map((col) => {
                  const HeaderIcon = getColumnHeaderIcon(col.key);
                  return (
                    <th
                      key={col.key}
                      className={`sortable${sort.key === col.key ? ' sorted' : ''}`}
                      style={{ minWidth: `${col.width || 120}px` }}
                      aria-sort={ariaSort(sort, col.key)}
                      title={sortHint(sort, col.key, col.key === 'site' ? 'Site / Floor' : col.label)}
                      onClick={() => toggleSort(col.key)}
                    >
                      <div className="th-content">
                        {HeaderIcon && <HeaderIcon size={13} className="th-icon" />}
                        <span>{col.key === 'site' ? 'Site / Floor' : col.label}</span>
                        <span className="sort-indicator">{sortGlyph(sort, col.key)}</span>
                      </div>
                    </th>
                  );
                })}
              </tr>

              {showAdvancedFilters && (
                <tr className="head-filters">
                  <th className="actions-col" />
                  {reportColumns.map((col) => (
                    <th key={col.key}>
                      <div className="col-filter">{renderFilterControl(col)}</div>
                    </th>
                  ))}
                </tr>
              )}
            </thead>
            <tbody>
              {loading && assets.length === 0 && (
                <tr>
                  <td className="table-empty" colSpan={reportColumns.length + 1}>
                    Loading the {meta.one} register…
                  </td>
                </tr>
              )}
              {!loading && pageRows.length === 0 && (
                <tr>
                  <td className="table-empty" colSpan={reportColumns.length + 1}>
                    {assets.length === 0
                      ? `No ${meta.many} yet. Add one from Data Entry, or upload a file.`
                      : `No matching ${meta.many}. Try adjusting or clearing filters.`}
                  </td>
                </tr>
              )}
              {pageRows.map((row) => (
                <tr
                  key={row.id}
                  {...longPress(row.id, () => toggleRow(row.id))}
                  className={[
                    'row-openable',
                    'longpress-row',
                    row.isDeleted ? 'row-deleted' : '',
                    selected.has(row.id) ? 'row-selected' : '',
                    pressing === row.id ? 'row-pressing' : '',
                    flash === row.id && selected.has(row.id) ? 'row-flash' : '',
                  ].filter(Boolean).join(' ')}
                  tabIndex={0}
                  role="link"
                  title="Open this record"
                  onClick={(e) => openRecord(e, row)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      navigate(`/report/${register}/${encodeURIComponent(row.id)}`);
                    }
                  }}
                >
                  <td className="actions-cell">
                    <label className="row-select" title="Select for a bulk action">
                      <input
                        type="checkbox"
                        checked={selected.has(row.id)}
                        onChange={() => toggleRow(row.id)}
                        aria-label={`Select ${row.assetId}`}
                      />
                    </label>

                    {canEdit && (
                      <button
                        type="button"
                        className="icon-btn"
                        title="Edit"
                        aria-label="Edit"
                        onClick={() => setEditing(row)}
                      >
                        <Pencil size={13} />
                      </button>
                    )}
                    {canWrite && (
                      <button
                        type="button"
                        className="icon-btn"
                        title="Clone"
                        aria-label="Clone"
                        onClick={() => handleClone(row)}
                      >
                        <Copy size={13} />
                      </button>
                    )}

                    <button
                      type="button"
                      className="icon-btn"
                      title="History — audit trail"
                      aria-label="History"
                      onClick={() => navigate(`/history/${encodeURIComponent(row.id)}`)}
                    >
                      <History size={13} />
                    </button>

                    {isSoftware && canWrite && !row.isDeleted && !row.pendingApproval
                      && !/sold/i.test(String(row.status || '')) && (
                      <button
                        type="button"
                        className="icon-btn"
                        title={isInStockStatus(row.status) ? 'Assign from stock' : 'Move to stock'}
                        aria-label={isInStockStatus(row.status) ? 'Assign from stock' : 'Move to stock'}
                        onClick={() => setMoving({ row, action: isInStockStatus(row.status) ? 'assign' : 'stock' })}
                      >
                        {isInStockStatus(row.status) ? <UserPlus size={13} /> : <ArrowDownToLine size={13} />}
                      </button>
                    )}

                    {isSuperadmin && row.isDeleted && (
                      <button
                        type="button"
                        className="icon-btn icon-btn-restore"
                        title="Restore"
                        aria-label="Restore"
                        onClick={() => setRestoring(row)}
                      >
                        <RotateCcw size={13} />
                      </button>
                    )}

                    {isSuperadmin && (
                      <button
                        type="button"
                        className="icon-btn icon-btn-purge"
                        title="Delete permanently"
                        aria-label="Delete permanently"
                        onClick={() => setPurging(row)}
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </td>

                  {reportColumns.map((col) => {
                    if (col.key === 'assetTag') {
                      const DeviceIcon = isSoftware ? Package : getDeviceIcon(row.type);
                      return (
                        <td key={col.key}>
                          <div className="asset-name-cell">
                            <span className="asset-thumbnail" title={isSoftware ? 'Software' : row.type}>
                              <DeviceIcon size={15} />
                            </span>
                            <div className="asset-name-text">
                              <span className="asset-title">{row.assetTag || row.model}</span>
                              {isSoftware ? (
                                <span className="asset-subtitle serial-mono">{row.assetId}</span>
                              ) : row.model && row.assetTag && row.model !== row.assetTag && (
                                <span className="asset-subtitle">{row.model}</span>
                              )}
                            </div>
                          </div>
                        </td>
                      );
                    }

                    if (isSoftware && col.key === 'price') {
                      return (
                        <td key={col.key} className="num-cell">
                          {isNotRecorded(row.price)
                            ? <span className="cell-empty">{NOT_RECORDED}</span>
                            : formatPrice(row.price)}
                        </td>
                      );
                    }
                    if (isSoftware && col.key === 'warrantyEnd') {
                      const days = row.isDeleted ? null : daysUntil(row.warrantyEnd);
                      return (
                        <td key={col.key}>
                          {isNotRecorded(row.warrantyEnd)
                            ? <span className="cell-empty">{NOT_RECORDED}</span>
                            : formatDate(row.warrantyEnd)}
                          {days !== null && days < 0 && (
                            <span className="renewal-tag is-overdue" title="The renewal date has passed">
                              Overdue
                            </span>
                          )}
                          {days !== null && days >= 0 && days <= RENEWAL_SOON_DAYS && (
                            <span className="renewal-tag is-soon" title={`Renews within ${RENEWAL_SOON_DAYS} days`}>
                              {days === 0 ? 'Today' : `In ${days} day${days === 1 ? '' : 's'}`}
                            </span>
                          )}
                        </td>
                      );
                    }

                    if (col.key === 'linkedPeripheralsText' && register === ASSET && canEdit
                      && !row.isDeleted && !row.pendingApproval && !String(row.linkedPeripheralsText || '').trim()) {
                      return (
                        <td key={col.key}>
                          <button
                            type="button"
                            className="assign-link-btn"
                            onClick={(e) => { e.stopPropagation(); setEditFocus('link'); setEditing(row); }}
                            title="Link a peripheral to this asset"
                          >
                            <Paperclip size={13} className="assign-link-icon" /> Link
                          </button>
                        </td>
                      );
                    }

                    if (col.key === 'user') {
                      const hasUser = row.user && row.user !== 'N/A' && !isNotRecorded(row.user);
                      if (!hasUser) {
                        return (
                          <td key={col.key}>
                            {canEdit ? (
                              <button
                                type="button"
                                className="assign-link-btn"
                                onClick={(e) => { e.stopPropagation(); setEditing(row); }}
                                title="Assign this asset"
                              >
                                + Assign
                              </button>
                            ) : (
                              <span className="cell-empty">{NOT_RECORDED}</span>
                            )}
                          </td>
                        );
                      }
                      return (
                        <td key={col.key}>
                          <div className="user-avatar-cell">
                            <span
                              className="user-cell-avatar"
                              style={{ background: getAvatarColor(row.user) }}
                            >
                              {getUserInitials(row.user)}
                            </span>
                            <span className="user-cell-name">{row.user}</span>
                          </div>
                        </td>
                      );
                    }

                    if (col.key === 'type') {
                      return (
                        <td key={col.key}>
                          <span className="category-pill">{row.type}</span>
                        </td>
                      );
                    }

                    if (col.key === 'status') {
                      return (
                        <td key={col.key}>
                          <StatusBadge status={row.status} />
                          {row.pendingApproval && (
                            <span
                              className="pending-approval-tag"
                              title={`Waiting for the IT head's approval -- asked by ${row.pendingApproval.requestedBy}`}
                            >
                              {row.pendingApproval.kind === 'scrap' ? 'Scrap pending' : 'Sale pending'}
                            </span>
                          )}
                        </td>
                      );
                    }

                    if (col.key === 'srl' || col.key === 'assetId' || col.key === 'sapId') {
                      return (
                        <td key={col.key}>
                          {isNotRecorded(row[col.key]) ? (
                            <span className="cell-empty">{NOT_RECORDED}</span>
                          ) : (
                            <span className="serial-mono">{row[col.key]}</span>
                          )}
                        </td>
                      );
                    }

                    if (col.key === 'site') {
                      return (
                        <td key={col.key}>
                          {formatSiteWithFloor(row) || <span className="cell-empty">{NOT_RECORDED}</span>}
                        </td>
                      );
                    }

                    return (
                      <td
                        key={col.key}
                        className={isNumericColumn(col) ? 'num-cell' : undefined}
                      >
                        {isNotRecorded(row[col.key])
                          ? <span className="cell-empty">{NOT_RECORDED}</span>
                          : (col.type === 'date' ? formatDate(row[col.key]) : row[col.key])}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="report-pagination">
          <div className="pagination-left">
            <label htmlFor="reportPageSize">Rows per page:</label>
            <select
              id="reportPageSize"
              className="pagination-select"
              value={pageSize}
              onChange={(e) => {
                setPageSize(e.target.value === 'all' ? 'all' : parseInt(e.target.value, 10));
                setPage(1);
              }}
            >
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
              <option value="all">All</option>
            </select>
            <span className="pagination-info">
              {sorted.length === 0 ? '0 of 0' : `${startIdx}–${endIdx} of ${sorted.length}`}
            </span>
          </div>

          <div className="pagination-controls">
            <button
              type="button"
              className="btn-page"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={safePage <= 1}
            >
              Previous
            </button>
            <span className="pagination-page-indicator">
              Page {safePage} of {totalPages}
            </span>
            <button
              type="button"
              className="btn-page"
              onClick={() => setPage((p) => p + 1)}
              disabled={safePage >= totalPages}
            >
              Next
            </button>
          </div>
        </div>

        {editing && (
          <AssetModal
            asset={editing}
            focusLink={editFocus === 'link'}
            onClose={() => { setEditing(null); setEditFocus(null); }}
          />
        )}

        {scanning && (
          <ScanSerialsModal
            queue={scanning}
            onClose={() => setScanning(null)}
            onFinished={finishScan}
          />
        )}

        {bulkEditing && (
          <BulkEditModal
            ids={bulkEditing}
            onClose={() => setBulkEditing(null)}
            onDone={finishBulkEdit}
          />
        )}

        {qrIds && <QrCodesModal ids={qrIds} onClose={() => setQrIds(null)} />}

        {historyRecords && (
          <MultiHistoryModal
            records={historyRecords}
            register={register}
            noun={meta.one}
            onClose={() => setHistoryRecords(null)}
          />
        )}

        {purging && (
          <PermanentDeleteModal
            record={purging}
            noun={meta.one}
            onClose={() => setPurging(null)}
            onDeleted={(text) => {
              setPurging(null);
              setSelected(new Set());
              setBanner({ text, kind: 'success' });
            }}
          />
        )}

        {restoring && (
          <RestoreModal
            row={restoring}
            noun={meta.one}
            onClose={() => setRestoring(null)}
            onRestored={handleRestored}
          />
        )}

        {moving && (
          <SoftwareMoveModal
            record={moving.row}
            action={moving.action}
            onClose={() => setMoving(null)}
            onDone={(text) => { setMoving(null); setBanner({ text, kind: 'success' }); }}
          />
        )}
      </div>
    </div>
  );
};

export default ReportPage;
