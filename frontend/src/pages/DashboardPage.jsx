import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ChartCard from '../components/ChartCard';
import KpiRow from '../components/KpiRow';
import RegisterToggle from '../components/RegisterToggle';
import { useAssets } from '../context/AssetsContext';
import { useTheme } from '../context/ThemeContext';
import { byKeyFor } from '../lib/schema';
import { AGE_BANDS, ageingSummary, bandDateRange, formatYears } from '../lib/ageing';
import { trendByYear } from '../lib/lifecycle';
import {
  buildAgeingBar, buildBreakdownBar, buildCatBar, buildLifecycleTrend, buildSeqBar, buildTrend,
  countBy, lifecycleLegend, otherBucket,
} from '../lib/charts';
import { UNSPECIFIED_LABEL, matchesOption, sortFilterOptions } from '../lib/dashboardFilters';
import {
  EXPIRING_SOON_DAYS, WARRANTY_EXPIRED, WARRANTY_SOON, WARRANTY_UNKNOWN, warrantySummary,
} from '../lib/warranty';
import { isInStock, isInUse, isScrapped, isSoldOrDisposed } from '../lib/statusClass';
import { todayIST } from '../lib/dates';
import { SOFTWARE } from '../lib/registers';
import './DashboardPage.css';

const RENEWAL_SOON_DAYS = 30;
const todayIso = () => todayIST();
const addDaysIso = (iso, days) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};
const rupees = (n) => `₹ ${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

function computeSoftwareTiles(rows) {
  const total = rows.length;
  const seats = rows.reduce((s, r) => s + (Number.parseInt(r.quantity, 10) || 0), 0);
  const active = rows.filter((r) => isInUse(r.status)).length;
  const inStock = rows.filter((r) => isInStock(r.status)).length;
  const today = todayIso();
  const soon = addDaysIso(today, RENEWAL_SOON_DAYS);
  const dated = rows.filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.warrantyEnd || ''));
  const overdue = dated.filter((r) => r.warrantyEnd < today).length;
  const dueSoon = dated.filter((r) => r.warrantyEnd >= today && r.warrantyEnd <= soon).length;
  const priced = rows.filter((r) => String(r.price ?? '').trim() !== '' && Number.isFinite(Number(r.price)));
  const value = priced.reduce((s, r) => s + Number(r.price), 0);
  const vendors = new Set(rows.map((r) => (r.vendor || '').trim().toLowerCase()).filter(Boolean)).size;
  const pct = (n) => (total ? `${Math.round((n / total) * 100)}% of softwares` : '—');
  return [
    { key: 'total', label: 'Total Softwares', value: fmt(total), sub: seats ? `${fmt(seats)} seats` : undefined },
    { key: 'active', label: 'In Use', value: fmt(active), sub: pct(active), tone: 'good' },
    { key: 'stock', label: 'In Stock', value: fmt(inStock), sub: pct(inStock) },
    dated.length === 0
      ? { key: 'renewal', label: 'Renewal Overdue', value: '—', sub: 'No renewal dates recorded' }
      : {
        key: 'renewal',
        label: 'Renewal Overdue',
        value: fmt(overdue),
        sub: dueSoon ? `${fmt(dueSoon)} due in ${RENEWAL_SOON_DAYS} days` : `of ${fmt(dated.length)} with a date`,
        tone: overdue ? 'critical' : 'good',
      },
    {
      key: 'value',
      label: 'Licence Value',
      value: priced.length ? rupees(value) : '—',
      sub: priced.length ? `across ${fmt(priced.length)} with a price` : 'No prices recorded',
    },
    { key: 'vendors', label: 'Vendors', value: fmt(vendors) },
  ];
}

const SoftwareDashboard = ({ live }) => {
  const { isDark } = useTheme();
  const [vendorFilter, setVendorFilter] = useState('');
  const vendorOptions = useMemo(
    () => sortFilterOptions(countBy(live, 'vendor').map((d) => d.label)),
    [live],
  );
  const rows = useMemo(() => live.filter((r) => matchesOption(r.vendor, vendorFilter)), [live, vendorFilter]);
  const tiles = useMemo(() => computeSoftwareTiles(rows), [rows]);
  const statusConfig = useMemo(() => buildCatBar(rows, 'status', isDark), [rows, isDark]);
  const vendorConfig = useMemo(() => buildSeqBar(rows, 'vendor', 8, isDark), [rows, isDark]);
  const nameConfig = useMemo(() => buildSeqBar(rows, 'assetTag', 8, isDark), [rows, isDark]);
  const renewalConfig = useMemo(() => buildTrend(rows, 'warrantyEnd', isDark), [rows, isDark]);
  const breakdown = useCallback((key, limit, noun) => {
    const bucket = otherBucket(rows, key, limit);
    if (!bucket.hidden) return undefined;
    return { ...bucket, noun, buildConfig: () => buildBreakdownBar(rows, key, isDark) };
  }, [rows, isDark]);

  return (
    <>
      <div className="filters-bar">
        <label htmlFor="filterVendor">Vendor / Used By</label>
        <select id="filterVendor" className="dash-select" value={vendorFilter}
          onChange={(e) => setVendorFilter(e.target.value)}>
          <option value="">All vendors</option>
          {vendorOptions.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <button type="button" className="btn-ghost" onClick={() => setVendorFilter('')}>
          Reset filters
        </button>
      </div>
      <KpiRow tiles={tiles} />
      <div className="dashboard-grid">
        <div className="dashboard-row dashboard-row-bottom">
          <ChartCard title="Softwares by Status" config={statusConfig} breakdown={breakdown('status', 8, 'statuses')} />
          <ChartCard title="Softwares by Vendor" config={vendorConfig} breakdown={breakdown('vendor', 8, 'vendors')} />
          <ChartCard title="Records by Software" config={nameConfig} breakdown={breakdown('assetTag', 8, 'softwares')} />
        </div>
        <div className="dashboard-row dashboard-row-single">
          <ChartCard title="Renewals (by Year)" config={renewalConfig}
            note="How many licences come up for renewal each year, from the Renewal Date." />
        </div>
      </div>
    </>
  );
};

const fmt = (n) => n.toLocaleString('en-IN');

const REFRESH_AFTER_YEARS = 5;

function computeKpiTiles(rows, noun = 'Assets') {
  const total = rows.length;
  const active = rows.filter((r) => isInUse(r.status)).length;
  const inStock = rows.filter((r) => isInStock(r.status)).length;
  const disposed = rows.filter((r) => isSoldOrDisposed(r.status, r.site)).length;
  const sites = new Set(rows.filter((r) => r.site).map((r) => r.site)).size;
  const pct = (n) => (total
    ? `${((n / total) * 100).toLocaleString('en-IN', {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3,
    })}% of fleet`
    : '—');

  const warranty = warrantySummary(rows, { refreshAfterYears: REFRESH_AFTER_YEARS });
  const recorded = warranty.counted - warranty[WARRANTY_UNKNOWN];

  return [
    {
      key: 'total',
      label: `Total ${noun}`,
      value: fmt(total),
      sub: warranty.overAge
        ? `${fmt(warranty.overAge)} over ${REFRESH_AFTER_YEARS} years old`
        : undefined,
    },
    { key: 'active', label: 'In Use', value: fmt(active), sub: pct(active), tone: 'good' },
    { key: 'stock', label: 'In Stock', value: fmt(inStock), sub: pct(inStock) },
    { key: 'disposed', label: 'Sold / Disposed', value: fmt(disposed), sub: pct(disposed), tone: 'critical' },
    recorded === 0
      ? {
        key: 'warranty',
        label: 'Out of Warranty',
        value: '—',
        sub: 'No warranty dates recorded',
      }
      : {
        key: 'warranty',
        label: 'Out of Warranty',
        value: fmt(warranty[WARRANTY_EXPIRED]),
        sub: warranty[WARRANTY_SOON]
          ? `${fmt(warranty[WARRANTY_SOON])} expiring in ${EXPIRING_SOON_DAYS} days`
          : `of ${fmt(recorded)} with a date`,
        tone: warranty[WARRANTY_EXPIRED] ? 'critical' : 'good',
      },
    { key: 'sites', label: 'Sites Covered', value: fmt(sites) },
  ];
}

const DashboardPage = () => {
  const { assets, loading, register, meta } = useAssets();
  const { isDark } = useTheme();
  const navigate = useNavigate();

  const typeLabel = byKeyFor('type', register)?.label || 'Type';
  const [typeFilter, setTypeFilter] = useState('');
  const [siteFilter, setSiteFilter] = useState('');

  const live = useMemo(() => assets.filter((r) => !isScrapped(r.status)), [assets]);

  const typeOptions = useMemo(
    () => sortFilterOptions(countBy(live, 'type').map((d) => d.label)),
    [live],
  );
  const siteOptions = useMemo(
    () => sortFilterOptions(countBy(live, 'site').map((d) => d.label)),
    [live],
  );

  const rows = useMemo(() => live.filter(
    (r) => matchesOption(r.type, typeFilter) && matchesOption(r.site, siteFilter),
  ), [live, typeFilter, siteFilter]);

  const tiles = useMemo(() => computeKpiTiles(rows, meta.label), [rows, meta.label]);

  const statusConfig = useMemo(() => buildCatBar(rows, 'status', isDark), [rows, isDark]);
  const siteConfig = useMemo(() => buildSeqBar(rows, 'site', 8, isDark), [rows, isDark]);
  const deptConfig = useMemo(() => buildSeqBar(rows, 'department', 8, isDark), [rows, isDark]);
  const companyConfig = useMemo(() => buildSeqBar(rows, 'company', 8, isDark), [rows, isDark]);
  const typeConfig = useMemo(() => buildCatBar(rows, 'type', isDark), [rows, isDark]);
  const trendConfig = useMemo(() => buildTrend(rows, 'dop', isDark), [rows, isDark]);
  const lifecycleConfig = useMemo(
    () => buildLifecycleTrend(trendByYear(rows), isDark),
    [rows, isDark],
  );

  const ageing = useMemo(() => ageingSummary(rows), [rows]);

  const openAgeBand = useCallback((index) => {
    const asValues = (v) => (!v ? [] : v === UNSPECIFIED_LABEL ? ['', UNSPECIFIED_LABEL] : [v]);
    navigate('/report', {
      state: {
        ageBand: { ...bandDateRange(index), label: AGE_BANDS[index].label },
        columnFilters: { type: asValues(typeFilter), site: asValues(siteFilter) },
      },
    });
  }, [navigate, typeFilter, siteFilter]);

  const ageingConfig = useMemo(
    () => buildAgeingBar(ageing, isDark, formatYears, openAgeBand),
    [ageing, isDark, openAgeBand],
  );
  const ageingNote = [
    `${fmt(ageing.dated)} of ${fmt(ageing.total)} with a purchase date`,
    ageing.future ? `${fmt(ageing.future)} dated in the future left out` : null,
  ].filter(Boolean).join(' · ');

  const breakdown = useCallback((key, limit, noun) => {
    const bucket = otherBucket(rows, key, limit);
    if (!bucket.hidden) return undefined;
    return {
      ...bucket,
      noun,
      buildConfig: () => buildBreakdownBar(rows, key, isDark),
    };
  }, [rows, isDark]);

  const isEmpty = live.length === 0;

  return (
    <div className="page-fixed dashboard-page">
      <div className="dash-header">
        <div className="dash-title">
          <div>
            <h1>{meta.label.replace(/s$/, '')} Overview</h1>
          </div>
          <RegisterToggle size="sm" />
        </div>

        {register !== SOFTWARE && (
        <div className="filters-bar">
          <label htmlFor="filterType">{typeLabel}</label>
          <select
            id="filterType"
            className="dash-select"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
          >
            <option value="">All {typeLabel}s</option>
            {typeOptions.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>

          <label htmlFor="filterSite">Location</label>
          <select
            id="filterSite"
            className="dash-select"
            value={siteFilter}
            onChange={(e) => setSiteFilter(e.target.value)}
          >
            <option value="">All Locations</option>
            {siteOptions.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>

          <button
            type="button"
            className="btn-ghost"
            onClick={() => { setTypeFilter(''); setSiteFilter(''); }}
          >
            Reset filters
          </button>
        </div>
        )}
      </div>

      {isEmpty ? (
        <div className="dashboard-empty">
          {loading ? (
            <p>Loading the {meta.one} register&hellip;</p>
          ) : (
            <>
              <h2>No {meta.one} data yet</h2>
              <p>
                Add records with the Data&nbsp;Entry form, or bulk-upload your existing
                Excel/CSV {meta.one} register to populate this dashboard.
              </p>
              <button type="button" className="btn-primary" onClick={() => navigate('/data-entry')}>
                Go to Data Entry
              </button>
            </>
          )}
        </div>
      ) : register === SOFTWARE ? (
        <SoftwareDashboard live={live} />
      ) : (
        <>
          <KpiRow tiles={tiles} />

          <div className="dashboard-grid">
            <div className="dashboard-row dashboard-row-top">
              <ChartCard
                title={`${meta.label} by Type`}
                config={typeConfig}
                breakdown={breakdown('type', 8, `${meta.one} types`)}
              />
              <ChartCard
                title={`${meta.label} by Status`}
                config={statusConfig}
                breakdown={breakdown('status', 8, 'statuses')}
              />
              <ChartCard
                title={`${meta.label} by Site / Location`}
                config={siteConfig}
                breakdown={breakdown('site', 8, 'sites')}
              />
              <ChartCard
                title={`${meta.label} by Department`}
                config={deptConfig}
                breakdown={breakdown('department', 8, 'departments')}
              />
              <ChartCard
                title={`${meta.label} by Company`}
                config={companyConfig}
                breakdown={breakdown('company', 8, 'companies')}
              />
            </div>

            <div className="dashboard-row dashboard-row-bottom">
              <ChartCard
                title={`${meta.label} by Age`}
                config={ageingConfig}
                headline={ageing.averageYears === null ? undefined : {
                  value: formatYears(ageing.averageYears),
                  label: 'average age',
                }}
                note={ageingNote}
              />
              <ChartCard
                title="New vs Replaced"
                config={lifecycleConfig}
                legend={lifecycleLegend(isDark)}
              />
              <ChartCard
                title="Procurement Trend (by Year)"
                config={trendConfig}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default DashboardPage;
