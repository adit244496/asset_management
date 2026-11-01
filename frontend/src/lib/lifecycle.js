import { ASSET } from './registers';

export const NEW = 'new';
export const REPLACED = 'replaced';

export const LIFECYCLE_TABS = [
  { key: NEW, label: 'New' },
  { key: REPLACED, label: 'Replaced' },
];

export const lifecycleOf = (row) => (row?.lifecycle === REPLACED ? REPLACED : NEW);

export const inFleet = (rows) => (rows || []).filter((r) => r && !r.isDeleted);

export function splitByLifecycle(rows) {
  const out = { [NEW]: [], [REPLACED]: [] };
  inFleet(rows).forEach((r) => out[lifecycleOf(r)].push(r));
  return out;
}

export function lifecycleColumns(register) {
  return [
    { key: 'model', label: 'Model Name' },
    register === ASSET
      ? { key: 'user', label: 'Assigned User' }
      : { key: 'linkedAssetText', label: 'Assigned Assets' },
    { key: 'location', label: 'Location' },
    { key: 'status', label: 'Status' },
  ];
}

export function searchRows(rows, query, columns) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return rows;
  const keys = [...columns.map((c) => c.key), 'assetId', 'srl', 'assetTag'];
  return rows.filter((r) => keys.some((k) => String(r[k] ?? '').toLowerCase().includes(q)));
}

export function trendByYear(rows) {
  const counts = {};
  let undated = 0;
  inFleet(rows).forEach((r) => {
    const year = /^(\d{4})-\d{2}-\d{2}$/.exec(String(r.dop || '').trim())?.[1];
    if (!year) { undated += 1; return; }
    counts[year] = counts[year] || { [NEW]: 0, [REPLACED]: 0 };
    counts[year][lifecycleOf(r)] += 1;
  });
  const present = Object.keys(counts).map(Number).sort((a, b) => a - b);
  const years = [];
  if (present.length) {
    for (let y = present[0]; y <= present[present.length - 1]; y += 1) years.push(String(y));
  }
  return {
    years,
    [NEW]: years.map((y) => counts[y]?.[NEW] || 0),
    [REPLACED]: years.map((y) => counts[y]?.[REPLACED] || 0),
    undated,
  };
}
