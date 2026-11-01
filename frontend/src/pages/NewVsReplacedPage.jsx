import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Repeat2 } from 'lucide-react';
import SearchBox from '../components/SearchBox';
import { useAssets } from '../context/AssetsContext';
import {
  LIFECYCLE_TABS, NEW, lifecycleColumns, searchRows, splitByLifecycle,
} from '../lib/lifecycle';
import { formatIfDate } from '../lib/dates';
import { NOT_RECORDED, isNotRecorded } from '../lib/notRecorded';
import { ASSET } from '../lib/registers';
import './NewVsReplacedPage.css';

const NewVsReplacedPage = () => {
  const { assets, loading, register, setRegister } = useAssets();
  const navigate = useNavigate();
  const [tab, setTab] = useState(NEW);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (register !== ASSET) setRegister(ASSET);
  }, [register, setRegister]);
  const rows = register === ASSET ? assets : [];

  const columns = useMemo(() => lifecycleColumns(ASSET), []);
  const groups = useMemo(() => splitByLifecycle(rows), [rows]);
  const shown = useMemo(() => searchRows(groups[tab], search, columns), [groups, tab, search, columns]);

  const cell = (v) => (isNotRecorded(v) || String(v ?? '').trim() === ''
    ? <span className="cell-empty">{NOT_RECORDED}</span> : formatIfDate(v));

  return (
    <div className="page-scroll lifecycle-page">
      <div className="page-card">
        <Link className="lifecycle-back" to="/report"><ArrowLeft size={14} /> Report</Link>
        <div className="page-header lifecycle-header">
          <div>
            <h1><Repeat2 size={19} /> New vs Replaced</h1>
          </div>
        </div>

        <div className="lifecycle-toolbar">
          <div className="lifecycle-tabs" role="tablist" aria-label="Show">
            {LIFECYCLE_TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                className={`lifecycle-tab is-${t.key}${tab === t.key ? ' active' : ''}`}
                onClick={() => setTab(t.key)}
              >
                {t.label}
                <span className="lifecycle-tab-count">{groups[t.key].length.toLocaleString('en-IN')}</span>
              </button>
            ))}
          </div>
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="Search model, user, location, status…"
            label="Search this list"
          />
          <span className="lifecycle-meta">
            {search.trim()
              ? `${shown.length.toLocaleString('en-IN')} of ${groups[tab].length.toLocaleString('en-IN')}`
              : `${groups[tab].length.toLocaleString('en-IN')} ${tab === NEW ? 'new' : 'replaced'}`}
          </span>
        </div>

        <div className="data-table-wrap lifecycle-table-wrap">
          <table className="data-table lifecycle-table">
            <thead>
              <tr>{columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr>
            </thead>
            <tbody>
              {(loading || register !== ASSET) && !rows.length && (
                <tr><td className="table-empty" colSpan={columns.length}>Loading&hellip;</td></tr>
              )}
              {!loading && register === ASSET && shown.length === 0 && (
                <tr>
                  <td className="table-empty" colSpan={columns.length}>
                    {search.trim()
                      ? 'Nothing here matches that search.'
                      : `No ${tab === NEW ? 'new' : 'replaced'} assets.`}
                  </td>
                </tr>
              )}
              {shown.map((row) => (
                <tr
                  key={row.id}
                  className="lifecycle-row"
                  onClick={() => navigate(`/report/${ASSET}/${encodeURIComponent(row.id)}`)}
                  title="Open this record"
                >
                  {columns.map((c) => <td key={c.key}>{cell(row[c.key])}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default NewVsReplacedPage;
