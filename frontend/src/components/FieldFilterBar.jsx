import { useEffect, useMemo, useRef, useState } from 'react';
import { Calendar, ChevronDown, Layers, Search, X } from 'lucide-react';
import { getDatePresets } from '../lib/datePresets';
import { isStoredDate } from '../lib/dates';
import { EMPTY_FILTER, isFiltering } from '../lib/fieldFilter';
import DateInput from './DateInput';
import '../pages/ReportPage.css';
import './FieldFilterBar.css';

const FieldFilterBar = ({ fields, value, onChange, allPlaceholder, children }) => {
  const state = value || EMPTY_FILTER;
  const { query, fieldKey, picks, ranges } = state;
  const [menu, setMenu] = useState(null);
  const rowRef = useRef(null);
  const presets = useMemo(() => getDatePresets(), []);

  useEffect(() => {
    if (!menu) return undefined;
    const onDown = (e) => {
      if (rowRef.current && !rowRef.current.contains(e.target)) setMenu(null);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menu]);

  const field = fields.find((f) => f.key === fieldKey) || null;
  const set = (patch) => onChange({ ...state, ...patch });
  const fieldPicks = field?.options ? (picks[field.key] || []) : [];
  const range = field?.date ? (ranges[field.key] || { from: '', to: '' }) : null;
  const setRange = (key, next) => set({ ranges: { ...ranges, [key]: next } });

  const togglePick = (key, v) => {
    const list = picks[key] || [];
    set({ picks: { ...picks, [key]: list.includes(v) ? list.filter((x) => x !== v) : [...list, v] } });
  };

  const labelOfPick = (f, v) => f.options?.find((o) => o.value === v)?.label ?? v;

  const chips = [
    ...fields.filter((f) => f.options && (picks[f.key] || []).length).map((f) => ({
      key: `p-${f.key}`,
      name: f.label,
      text: picks[f.key].map((v) => labelOfPick(f, v)).join(', '),
      clear: () => set({ picks: { ...picks, [f.key]: [] } }),
    })),
    ...fields.filter((f) => f.date && (ranges[f.key]?.from || ranges[f.key]?.to)).map((f) => {
      const { from, to } = ranges[f.key];
      return {
        key: `r-${f.key}`,
        name: f.label,
        text: from && to ? `${from} → ${to}` : from ? `from ${from}` : `until ${to}`,
        clear: () => setRange(f.key, { from: '', to: '' }),
      };
    }),
  ];

  return (
    <>
      <div className="report-filter-row field-filter-row" ref={rowRef}>
        {range ? (
          <div className="report-search-wrap report-date-range-wrap">
            <Calendar size={14} className="report-search-icon" />
            <span className="report-date-label">From</span>
            <DateInput className="report-date-range-input" value={range.from || ''}
              aria-label={`${field.label} from`}
              onChange={(v) => { if (v === '' || isStoredDate(v)) setRange(field.key, { ...range, from: v }); }} />
            <span className="report-date-label">To</span>
            <DateInput className="report-date-range-input" value={range.to || ''}
              aria-label={`${field.label} to`}
              onChange={(v) => { if (v === '' || isStoredDate(v)) setRange(field.key, { ...range, to: v }); }} />
            {(range.from || range.to) && (
              <button type="button" className="report-search-clear" title="Clear date range"
                aria-label="Clear date range" onClick={() => setRange(field.key, { from: '', to: '' })}>
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
              placeholder={field?.search ? `Search ${field.label}…` : allPlaceholder}
              aria-label={field?.search ? `Search ${field.label}` : allPlaceholder}
              value={query}
              onChange={(e) => set({ query: e.target.value })}
            />
            {query && (
              <button type="button" className="report-search-clear" aria-label="Clear search"
                onClick={() => set({ query: '' })}>
                <X size={13} />
              </button>
            )}
          </div>
        )}

        <div className="filter-pill-wrap">
          <button
            type="button"
            className={`filter-pill${field ? ' active' : ''}`}
            onClick={() => setMenu(menu === 'field' ? null : 'field')}
            aria-haspopup="listbox"
            aria-expanded={menu === 'field'}
            title="Choose which field to filter on"
          >
            <Layers size={13} />
            <span>{field ? `Filter: ${field.label}` : 'Filter'}</span>
            <ChevronDown size={12} className="pill-caret" />
          </button>
          {menu === 'field' && (
            <div className="filter-pill-popover" role="listbox" aria-label="Filter on">
              <div className="pill-popover-header">Search in</div>
              <div className="pill-popover-list">
                <button type="button" role="option" aria-selected={!field}
                  className={`pill-popover-option${!field ? ' selected' : ''}`}
                  onClick={() => { set({ fieldKey: '' }); setMenu(null); }}>
                  All fields
                </button>
                {fields.map((f) => (
                  <button key={f.key} type="button" role="option" aria-selected={fieldKey === f.key}
                    className={`pill-popover-option${fieldKey === f.key ? ' selected' : ''}`}
                    onClick={() => { set({ fieldKey: f.key }); setMenu(null); }}>
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {field?.options && (
          <div className="filter-pill-wrap">
            <button
              type="button"
              className={`filter-pill${fieldPicks.length ? ' active' : ''}`}
              onClick={() => setMenu(menu === 'values' ? null : 'values')}
              aria-haspopup="listbox"
              aria-expanded={menu === 'values'}
              title={`Show only these ${field.label} values`}
            >
              <span>
                {fieldPicks.length === 1
                  ? labelOfPick(field, fieldPicks[0])
                  : fieldPicks.length ? `${field.label} (${fieldPicks.length})` : `Any ${field.label}`}
              </span>
              <ChevronDown size={12} className="pill-caret" />
            </button>
            {menu === 'values' && (
              <div className="filter-pill-popover">
                <div className="pill-popover-header">{field.label}</div>
                <div className="pill-popover-list">
                  {!field.options.length && <div className="pill-popover-empty">Nothing to choose from.</div>}
                  {field.options.map((o) => (
                    <label key={o.value} className="pill-popover-item">
                      <input type="checkbox" checked={fieldPicks.includes(o.value)}
                        onChange={() => togglePick(field.key, o.value)} />
                      <span>{o.label}</span>
                    </label>
                  ))}
                </div>
                {fieldPicks.length > 0 && (
                  <button type="button" className="pill-popover-clear"
                    onClick={() => set({ picks: { ...picks, [field.key]: [] } })}>
                    Clear {field.label.toLowerCase()} filter
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {range && (
          <div className="filter-pill-wrap">
            <button
              type="button"
              className={`filter-pill${range.from || range.to ? ' active' : ''}`}
              onClick={() => setMenu(menu === 'range' ? null : 'range')}
              aria-haspopup="dialog"
              aria-expanded={menu === 'range'}
              title={`Quick ranges for ${field.label}`}
            >
              <Calendar size={13} />
              <span>Quick Range</span>
              <ChevronDown size={12} className="pill-caret" />
            </button>
            {menu === 'range' && (
              <div className="filter-pill-popover date-range-popover">
                <div className="pill-popover-header">{field.label}</div>
                <div className="date-range-presets-list">
                  {presets.map((p) => (
                    <button key={p.label} type="button" className="date-range-preset-item"
                      onClick={() => { setRange(field.key, { from: p.from, to: p.to }); setMenu(null); }}>
                      <span className="preset-label">{p.label}</span>
                      <span className="preset-dates">{p.from} → {p.to}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {isFiltering(state) && (
          <button type="button" className="btn-clear-pill" title="Clear the search and every filter"
            onClick={() => { setMenu(null); onChange({ ...EMPTY_FILTER, fieldKey: '' }); }}>
            <X size={12} /> Reset
          </button>
        )}

        {children && <div className="field-filter-extra">{children}</div>}
      </div>

      {chips.length > 0 && (
        <div className="field-filter-chips">
          {chips.map((c) => (
            <span key={c.key} className="field-filter-chip">
              <span className="field-filter-chip-key">{c.name}:</span>
              {c.text}
              <button type="button" aria-label={`Remove the ${c.name} filter`} onClick={c.clear}>
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
    </>
  );
};

export default FieldFilterBar;
