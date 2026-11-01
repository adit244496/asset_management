import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileText, ScrollText, ShieldAlert } from 'lucide-react';
import api, { errorMessage } from '../api';
import ActivityReport from '../components/ActivityReport';
import Banner from '../components/Banner';
import DateInput from '../components/DateInput';
import ExportMenu from '../components/ExportMenu';
import SearchBox from '../components/SearchBox';
import { useAuth } from '../context/AuthContext';
import {
  categoryLabel, changeText, describeFilters, exportFilename, formatWhen, dash,
  outcomeLabel, outcomeTone, sourceLabel, subjectOf, toRows,
} from '../lib/activity';
import { isStoredDate } from '../lib/dates';
import { exportActivityCSV, exportActivityXLSX } from '../lib/exporters';
import './ActivityLogPage.css';

const PAGE_SIZE = 50;

const EXPORT_LIMIT = 20000;

const EMPTY_FILTERS = { q: '', actor: '', category: '', outcome: '', from: '', to: '' };

const ActivityLogPage = () => {
  const { user } = useAuth();
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState(0);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState(null);
  const [busy, setBusy] = useState(false);
  const [reportRows, setReportRows] = useState(null);

  const params = useMemo(() => {
    const out = { limit: PAGE_SIZE, offset: page * PAGE_SIZE };
    Object.entries(filters).forEach(([k, v]) => { if (v) out[k] = v; });
    return out;
  }, [filters, page]);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/activity', { params });
      setData(res.data || { items: [], total: 0 });
    } catch (err) {
      setBanner({ text: errorMessage(err, 'Could not load the activity log.'), kind: 'error' });
    } finally {
      setLoading(false);
    }
  }, [params]);

  useEffect(() => { load(); }, [load]);

  const setFilter = (key, value) => {
    setLoading(true);
    setPage(0);
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const clearFilters = () => {
    setLoading(true);
    setPage(0);
    setFilters(EMPTY_FILTERS);
  };

  const goToPage = (next) => {
    setLoading(true);
    setPage(next);
  };

  const filterSummary = useMemo(() => describeFilters(filters), [filters]);
  const filtered = Object.values(filters).some(Boolean);

  const fetchAll = useCallback(async () => {
    const out = { limit: EXPORT_LIMIT, offset: 0 };
    Object.entries(filters).forEach(([k, v]) => { if (v) out[k] = v; });
    const res = await api.get('/activity', { params: out });
    return res.data || { items: [], total: 0 };
  }, [filters]);

  const runExport = async (writer, what) => {
    setBusy(true);
    try {
      const all = await fetchAll();
      if (!all.items.length) {
        setBanner({ text: 'Nothing to export — no activity matches these filters.', kind: 'info' });
        return;
      }
      await writer(all);
      setBanner({
        text: `${what}: ${all.items.length.toLocaleString('en-IN')} entries (${filterSummary}).`,
        kind: 'success',
      });
    } catch (err) {
      setBanner({ text: errorMessage(err, 'Could not build the export.'), kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const exportOptions = [
    {
      label: 'CSV',
      onSelect: () => runExport(
        (all) => exportActivityCSV(toRows(all.items), exportFilename('csv')),
        'Exported CSV',
      ),
    },
    {
      label: 'Excel',
      onSelect: () => runExport(
        (all) => exportActivityXLSX(toRows(all.items), exportFilename('xlsx'), filterSummary),
        'Exported Excel',
      ),
    },
  ];

  const downloadPDF = async () => {
    setBusy(true);
    try {
      const all = await fetchAll();
      if (!all.items.length) {
        setBanner({ text: 'Nothing to print — no activity matches these filters.', kind: 'info' });
        return;
      }
      setReportRows(all);
      await new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      });
      window.print();
    } catch (err) {
      setBanner({ text: errorMessage(err, 'Could not build the report.'), kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const items = data?.items || [];
  const total = data?.total || 0;
  const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min(total, (page + 1) * PAGE_SIZE);
  const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);

  let countLine;
  if (loading && !data) {
    countLine = 'Loading…';
  } else if (total === 0) {
    countLine = filtered ? 'No entries match these filters' : 'No activity recorded yet';
  } else {
    countLine = `${from.toLocaleString('en-IN')}–${to.toLocaleString('en-IN')} of `
      + `${total.toLocaleString('en-IN')} entr${total === 1 ? 'y' : 'ies'}`
      + (filtered ? ' matching' : '');
  }
  if (data?.clearedAt) {
    countLine += ` · cleared ${formatWhen(data.clearedAt)} after the scheduled email`;
  }

  return (
    <div className="page-scroll activity-page">
      <div className="page-card">
        <div className="page-header">
          <h1><ScrollText size={19} /> Activity Log</h1>
        </div>

        <Banner banner={banner} onDismiss={() => setBanner(null)} />

        <div className="activity-filters">
          <SearchBox
            value={filters.q}
            onChange={(v) => setFilter('q', v)}
            placeholder="Search who, what, or which value&hellip;"
            label="Search the activity log"
          />

          <select
            value={filters.actor}
            onChange={(e) => setFilter('actor', e.target.value)}
            aria-label="Filter by who did it"
          >
            <option value="">Anyone</option>
            {(data?.actors || []).map((a) => <option key={a} value={a}>{a}</option>)}
          </select>

          <select
            value={filters.category}
            onChange={(e) => setFilter('category', e.target.value)}
            aria-label="Filter by area"
          >
            <option value="">All areas</option>
            {(data?.categories || []).map((c) => (
              <option key={c} value={c}>{categoryLabel(c)}</option>
            ))}
          </select>

          <select
            value={filters.outcome}
            onChange={(e) => setFilter('outcome', e.target.value)}
            aria-label="Filter by outcome"
          >
            <option value="">Any outcome</option>
            {(data?.outcomes || []).map((o) => (
              <option key={o} value={o}>{outcomeLabel(o)}</option>
            ))}
          </select>

          <label className="activity-date">
            From
            <DateInput
              value={filters.from}
              onChange={(v) => { if (v === '' || isStoredDate(v)) setFilter('from', v); }}
            />
          </label>
          <label className="activity-date">
            To
            <DateInput
              value={filters.to}
              onChange={(v) => { if (v === '' || isStoredDate(v)) setFilter('to', v); }}
            />
          </label>

          {filtered && (
            <button type="button" className="btn-ghost" onClick={clearFilters}>
              Clear filters
            </button>
          )}
        </div>

        <div className="activity-bar">
          <span className="activity-count">{countLine}</span>
          <div className="activity-actions">
            <ExportMenu options={exportOptions} busy={busy} disabled={total === 0} />
            <button
              type="button"
              className="btn-secondary activity-btn"
              onClick={downloadPDF}
              disabled={busy || total === 0}
            >
              <FileText size={14} /> PDF report
            </button>
          </div>
        </div>

        <div className={`data-table-wrap activity-table-wrap${loading && data ? ' is-loading' : ''}`}>
          <table className="data-table activity-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>Area</th>
                <th>What happened</th>
                <th>Outcome</th>
                <th className="activity-wide-only">Kind</th>
                <th className="activity-wide-only">From</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row, i) => {
                const subject = subjectOf(row);
                return (
                  <tr key={`${row.at}-${i}`} className={row.outcome === 'ok' ? '' : 'activity-notable'}>
                    <td className="activity-when">
                      {(() => {
                        const when = formatWhen(row.at);
                        const cut = when.indexOf(', ');
                        if (cut < 0) return when;
                        return (
                          <>
                            <span className="activity-when-part">{when.slice(0, cut)},</span>{' '}
                            <span className="activity-when-part">{when.slice(cut + 2)}</span>
                          </>
                        );
                      })()}
                    </td>
                    <td className="activity-who">{dash(row.actor)}</td>
                    <td className="activity-muted">{categoryLabel(row.category)}</td>
                    <td className="activity-what">
                      {subject && <span className="activity-subject">{subject}</span>}
                      {changeText(row)}
                    </td>
                    <td>
                      <span className="status-badge">
                        <span className="status-dot" style={{ background: outcomeTone(row.outcome) }} />
                        {outcomeLabel(row.outcome)}
                      </span>
                    </td>
                    <td className="activity-muted activity-wide-only">{sourceLabel(row.source)}</td>
                    <td className="activity-muted activity-ip activity-wide-only">{dash(row.ip)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {!loading && !items.length && (
            <div className="activity-empty">
              {filtered
                ? 'Nothing matches these filters.'
                : 'Nothing recorded yet. The log starts from the first action after it was added.'}
            </div>
          )}
          {loading && !data && <div className="activity-empty">Loading activity&hellip;</div>}
        </div>

        {lastPage > 0 && (
          <div className="activity-pagination">
            <button type="button" onClick={() => goToPage(0)} disabled={page === 0 || loading}>
              First
            </button>
            <button type="button" onClick={() => goToPage(page - 1)} disabled={page === 0 || loading}>
              Previous
            </button>
            <span>
              Page {(page + 1).toLocaleString('en-IN')} of {(lastPage + 1).toLocaleString('en-IN')}
            </span>
            <button type="button" onClick={() => goToPage(page + 1)} disabled={page >= lastPage || loading}>
              Next
            </button>
            <button type="button" onClick={() => goToPage(lastPage)} disabled={page >= lastPage || loading}>
              Last
            </button>
          </div>
        )}

        <p className="activity-note">
          <ShieldAlert size={13} />
          This log is append-only and has no edit or delete — not even for a
          superadmin. A record its subject can change is not evidence of
          anything.
        </p>

        {reportRows && (
          <ActivityReport
            items={reportRows.items}
            total={reportRows.total}
            filterSummary={filterSummary}
            generatedBy={user?.fullName || user?.username}
          />
        )}
      </div>
    </div>
  );
};

export default ActivityLogPage;
