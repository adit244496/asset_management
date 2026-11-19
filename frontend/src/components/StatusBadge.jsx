import { useAssets } from '../context/AssetsContext';
import { useTheme } from '../context/ThemeContext';
import { statusColor } from '../lib/charts';
import { isExpiredSoftware } from '../lib/softwareUsage';

// A record's status (a software's Usage). Pass the `record` (and its
// `register` when the record does not say): an expired software then shows
// "—" instead of its Usage, on every screen that uses this badge.
const StatusBadge = ({ status, record = null, register = undefined }) => {
  const { optionsFor } = useAssets();
  const { isDark } = useTheme();
  if (record && isExpiredSoftware(record, register ?? record.register)) {
    return <span className="cell-empty" title="Expired — its Renewal Date has passed">—</span>;
  }
  const value = status ?? record?.status;
  if (!value) return null;

  return (
    <span className="status-badge">
      <span className="status-dot" style={{ background: statusColor(value, optionsFor('status'), isDark) }} />
      {value}
    </span>
  );
};

export default StatusBadge;
