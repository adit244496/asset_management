import { useAssets } from '../context/AssetsContext';
import { useTheme } from '../context/ThemeContext';
import { statusColor } from '../lib/charts';

const StatusBadge = ({ status }) => {
  const { optionsFor } = useAssets();
  const { isDark } = useTheme();
  if (!status) return null;

  return (
    <span className="status-badge">
      <span className="status-dot" style={{ background: statusColor(status, optionsFor('status'), isDark) }} />
      {status}
    </span>
  );
};

export default StatusBadge;
