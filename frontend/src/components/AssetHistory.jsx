import { useEffect, useMemo, useState } from 'react';
import { errorMessage } from '../api';
import { useAssets } from '../context/AssetsContext';
import { groupEvents } from '../lib/historyGroups';
import HistoryGroup from './HistoryGroup';
import './AssetHistory.css';

const AssetHistory = ({ assetId, assetNumber, register = null }) => {
  const { assetHistory, register: current } = useAssets();
  const reg = register || current;
  const [events, setEvents] = useState(null);
  const [error, setError] = useState('');
  const [openIds, setOpenIds] = useState(() => new Set());

  useEffect(() => {
    let live = true;
    assetHistory(assetId, reg)
      .then((res) => { if (live) setEvents(res.items || []); })
      .catch((err) => { if (live) setError(errorMessage(err, 'Could not load the history.')); });
    return () => { live = false; };
  }, [assetId, assetHistory, reg]);

  const groups = useMemo(
    () => groupEvents(events || [], { register: reg }),
    [events, reg],
  );

  const toggle = (id) => setOpenIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  if (error) return <div className="banner banner-error">{error}</div>;
  if (events === null) return <div className="hist-empty">Loading history&hellip;</div>;

  if (!events.length) {
    return (
      <div className="hist-empty">
        Nothing recorded yet. History starts from the first change after this
        feature was added, so an asset that has not been touched since shows
        nothing here.
      </div>
    );
  }

  return (
    <ol className="hist">
      {groups.map((group) => (
        <HistoryGroup
          key={group.id}
          group={group}
          register={reg}
          assetNumber={assetNumber}
          dense
          open={openIds.has(group.id)}
          onToggle={() => toggle(group.id)}
        />
      ))}
    </ol>
  );
};

export default AssetHistory;
