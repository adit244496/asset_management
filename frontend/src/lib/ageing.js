import { ageYears, parseDate, startOfToday } from './warranty';

const YEAR_MS = 365.2425 * 24 * 60 * 60 * 1000;

export const AGE_BANDS = [
  { min: 0, label: 'Under 1 yr' },
  { min: 1, label: '1–2 yrs' },
  { min: 2, label: '2–3 yrs' },
  { min: 3, label: '3–4 yrs' },
  { min: 4, label: '4–5 yrs' },
  { min: 5, label: '5+ yrs' },
];

export function bandIndex(years) {
  return Math.min(Math.max(years, 0), AGE_BANDS.length - 1);
}

export function ageingSummary(rows, now = new Date()) {
  const today = startOfToday(now);
  const bands = AGE_BANDS.map((b) => ({ ...b, count: 0, sum: 0, pos: new Set() }));
  let dated = 0;
  let undated = 0;
  let future = 0;
  let sum = 0;
  let oldest = null;

  (rows || []).forEach((r) => {
    const bought = parseDate(r?.dop);
    if (bought === null) { undated += 1; return; }
    if (bought > today) { future += 1; return; }
    const exact = (today - bought) / YEAR_MS;
    const band = bands[bandIndex(ageYears(r, now))];
    band.count += 1;
    band.sum += exact;
    const po = (r.poNo || '').trim();
    if (po) band.pos.add(po);
    dated += 1;
    sum += exact;
    if (oldest === null || exact > oldest) oldest = exact;
  });

  return {
    bands: bands.map((b) => ({
      label: b.label,
      count: b.count,
      share: dated ? b.count / dated : 0,
      averageYears: b.count ? b.sum / b.count : null,
      poCount: b.pos.size,
    })),
    dated,
    undated,
    future,
    total: (rows || []).length,
    averageYears: dated ? sum / dated : null,
    oldestYears: oldest,
  };
}

const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

function minusYears(ms, years) {
  const d = new Date(ms);
  const y = d.getUTCFullYear() - years;
  const m = d.getUTCMonth();
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return Date.UTC(y, m, Math.min(d.getUTCDate(), lastDay));
}

export function bandDateRange(index, now = new Date()) {
  const today = startOfToday(now);
  const last = AGE_BANDS.length - 1;
  const n = Math.min(Math.max(index, 0), last);
  const to = iso(minusYears(today, AGE_BANDS[n].min));
  if (n === last) return { from: '', to };
  const DAY = 24 * 60 * 60 * 1000;
  return { from: iso(minusYears(today, AGE_BANDS[n].min + 1) + DAY), to };
}

export function formatYears(years) {
  if (years === null || years === undefined) return '—';
  if (years < 1) {
    const months = Math.max(1, Math.round(years * 12));
    return `${months} month${months === 1 ? '' : 's'}`;
  }
  const v = Math.round(years * 10) / 10;
  return `${v.toLocaleString('en-IN', { maximumFractionDigits: 1 })} year${v === 1 ? '' : 's'}`;
}
