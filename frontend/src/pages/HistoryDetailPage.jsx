import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Download, History, Table } from 'lucide-react';
import { errorMessage } from '../api';
import Banner from '../components/Banner';
import HistoryGroup from '../components/HistoryGroup';
import HistoryReport from '../components/HistoryReport';
import StatusBadge from '../components/StatusBadge';
import { useAssets } from '../context/AssetsContext';
import { useAuth } from '../context/AuthContext';
import { formatDate } from '../lib/dates';
import { groupEvents } from '../lib/historyGroups';
import '../components/AssetHistory.css';
import './HistoryDetailPage.css';

function byDay(groups) {
  const days = [];
  groups.forEach((group) => {
    const at = new Date(group.at);
    const key = Number.isNaN(at.getTime()) ? 'unknown' : formatDate(at);
    const last = days[days.length - 1];
    if (last && last.key === key) last.groups.push(group);
    else days.push({ key, groups: [group] });
  });
  return days;
}

const HistoryDetailPage = () => {
  const { assetPk } = useParams();
  const { assetHistory, register } = useAssets();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [data, setData] = useState(null);
  const [banner, setBanner] = useState(null);
  const [openIds, setOpenIds] = useState(() => new Set());

  useEffect(() => {
    let live = true;
    assetHistory(assetPk)
      .then((res) => { if (live) setData(res); })
      .catch((err) => {
        if (live) {
          setBanner({ text: errorMessage(err, 'Could not load this asset.'), kind: 'error' });
        }
      });
    return () => { live = false; };
  }, [assetPk, assetHistory]);

  const asset = data?.asset;
  const events = useMemo(() => data?.items || [], [data]);
  const groups = useMemo(
    () => groupEvents(events, { register }),
    [events, register],
  );
  const expandable = groups.filter((g) => g.events.length > 1);
  const allOpen = expandable.length > 0 && expandable.every((g) => openIds.has(g.id));

  const toggle = (id) => setOpenIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const toggleAll = () => setOpenIds(
    allOpen ? new Set() : new Set(expandable.map((g) => g.id)),
  );

  return (
    <div className="page-scroll history-detail">
      <Link to="/history" className="hist-back">
        <ArrowLeft size={14} /> All history
      </Link>

      <Banner banner={banner} onDismiss={() => setBanner(null)} />

      {!data && !banner && <div className="hist-empty-state">Loading&hellip;</div>}

      {asset && (
        <>
          <div className="hist-detail-head">
            <div className="hist-detail-identity">
              <div className="hist-detail-id">{asset.assetId}</div>
              <h1>{asset.assetTag || asset.model}</h1>
              <div className="hist-detail-facts">
                <StatusBadge status={asset.status} />
                <span>{asset.model || '—'}</span>
                <span>{asset.user || '—'}</span>
                <span>{[asset.site, asset.floor].filter(Boolean).join(' · ') || '—'}</span>
                {asset.srl && <span className="hist-detail-srl">Srl {asset.srl}</span>}
              </div>
            </div>

            <div className="hist-detail-actions">
              <button type="button" className="btn-secondary" onClick={() => window.print()}>
                <Download size={14} /> Download PDF
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => navigate('/report', { state: { search: asset.assetId } })}
              >
                <Table size={14} /> Show in Report Section
              </button>
            </div>
          </div>

          <div className="hist-detail-count">
            <span>
              {groups.length.toLocaleString('en-IN')} entr{groups.length === 1 ? 'y' : 'ies'}
              {groups.length !== events.length && (
                <> from {events.length.toLocaleString('en-IN')} recorded changes</>
              )}
              , newest first
            </span>
            {expandable.length > 0 && (
              <button type="button" className="hist-expand-all" onClick={toggleAll}>
                {allOpen ? 'Collapse all' : 'Expand all'}
              </button>
            )}
          </div>

          {!events.length ? (
            <div className="hist-empty-state">
              Nothing recorded for this asset. History starts from the first change
              after this feature was added, so an asset untouched since then shows
              nothing here.
            </div>
          ) : (
            byDay(groups).map((day) => (
              <div className="hist-day" key={day.key}>
                <div className="hist-day-label">{day.key}</div>
                <ol className="hist hist-detail-list">
                  {day.groups.map((group) => (
                    <HistoryGroup
                      key={group.id}
                      group={group}
                      register={register}
                      assetNumber={asset.assetId}
                      open={openIds.has(group.id)}
                      onToggle={() => toggle(group.id)}
                    />
                  ))}
                </ol>
              </div>
            ))
          )}
        </>
      )}

      {!asset && data && (
        <div className="hist-empty-state">
          <History size={22} />
          <p>This asset is no longer in the register.</p>
        </div>
      )}

      {asset && (
        <HistoryReport
          asset={asset}
          groups={groups}
          events={events}
          register={register}
          generatedBy={user?.fullName || user?.username}
        />
      )}
    </div>
  );
};

export default HistoryDetailPage;
