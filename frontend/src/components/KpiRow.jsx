import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import './KpiRow.css';

// On phones the tiles start collapsed behind a small Show KPIs toggle; elsewhere the toggle is hidden.
const KpiRow = ({ tiles }) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={`kpi-toggle${open ? ' is-open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? 'Hide KPIs' : 'Show KPIs'}
        <ChevronDown size={14} className="kpi-toggle-caret" aria-hidden="true" />
      </button>
      <div className={`kpi-row${open ? '' : ' is-collapsed'}`}>
        {tiles.map(({ key, label, value, sub, tone }) => (
          <div className="kpi-tile" key={key}>
            <div className="kpi-label">{label}</div>
            <div className={`kpi-value${tone ? ` kpi-value-${tone}` : ''}`}>{value}</div>
            {sub !== undefined && <div className="kpi-sub">{sub}</div>}
          </div>
        ))}
      </div>
    </>
  );
};

export default KpiRow;
