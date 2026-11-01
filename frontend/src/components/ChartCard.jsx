import { useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, X } from 'lucide-react';
import { Chart } from '../lib/charts';
import './ChartCard.css';

const ROW_HEIGHT = 21;
const AXIS_BAND = 34;
const MIN_PLOT = 160;

function useChart(ref, config) {
  useEffect(() => {
    if (!ref.current || !config) return undefined;
    const chart = new Chart(ref.current, config);
    return () => chart.destroy();
  }, [ref, config]);
}

const BreakdownModal = ({ title, breakdown, onClose }) => {
  const canvasRef = useRef(null);
  const config = useMemo(() => breakdown.buildConfig(), [breakdown]);
  useChart(canvasRef, config);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const height = Math.max(MIN_PLOT, breakdown.total * ROW_HEIGHT) + AXIS_BAND;

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal chart-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2>{title}</h2>
            <div className="chart-modal-sub">
              All {breakdown.total.toLocaleString('en-IN')} {breakdown.noun}
              {breakdown.hidden > 0 && (
                <>
                  {' — '}
                  {breakdown.hidden.toLocaleString('en-IN')} of them were grouped as
                  {' '}<strong>Other</strong> ({breakdown.hiddenTotal.toLocaleString('en-IN')}
                  {' '}between them)
                </>
              )}
            </div>
          </div>
          <button type="button" className="modal-close" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <div className="chart-modal-plot" style={{ height: `${height}px` }}>
            <canvas ref={canvasRef} />
          </div>
        </div>
      </div>
    </div>
  );
};

const ChartCard = ({ title, config, breakdown, headline, note, legend, className = '' }) => {
  const canvasRef = useRef(null);
  const [open, setOpen] = useState(false);
  useChart(canvasRef, config);

  const canExpand = Boolean(breakdown?.hidden);

  return (
    <div className={`chart-card ${className}`.trim()}>
      <div className="chart-card-head">
        <h2>{title}</h2>
        {legend && (
          <ul className="chart-legend">
            {legend.map((item) => (
              <li key={item.label}>
                <span
                  className={`chart-legend-swatch${item.shape === 'box' ? ' is-box' : ''}`}
                  style={{ background: item.color }}
                  aria-hidden="true"
                />
                {item.label}
              </li>
            ))}
          </ul>
        )}
        {headline && (
          <div className="chart-headline">
            <span className="chart-headline-value">{headline.value}</span>
            <span className="chart-headline-label">{headline.label}</span>
          </div>
        )}
        {canExpand && (
          <button
            type="button"
            className="chart-expand"
            onClick={() => setOpen(true)}
            title={`Show all ${breakdown.total} ${breakdown.noun} — `
              + `${breakdown.hidden} are grouped as Other`}
          >
            <Maximize2 size={13} />
            <span>+{breakdown.hidden} in Other</span>
          </button>
        )}
      </div>
      {note && <div className="chart-note">{note}</div>}

      <div className="chart-canvas-wrap">
        <canvas ref={canvasRef} />
      </div>

      {open && (
        <BreakdownModal title={title} breakdown={breakdown} onClose={() => setOpen(false)} />
      )}
    </div>
  );
};

export default ChartCard;
