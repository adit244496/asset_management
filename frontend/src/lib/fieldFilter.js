import { fold, matchesAll, searchTerms } from './textSearch';

export const EMPTY_FILTER = Object.freeze({ query: '', fieldKey: '', picks: {}, ranges: {} });

const pickOf = (field, row) => (field.pick ? field.pick(row) : field.get(row));

export function applyFieldFilter(rows, state, fields, allFieldsHaystack) {
  const { query = '', fieldKey = '', picks = {}, ranges = {} } = state || {};
  const field = fields.find((f) => f.key === fieldKey);
  const terms = searchTerms(query);
  const picked = fields.filter((f) => f.options && (picks[f.key] || []).length);
  const ranged = fields.filter((f) => f.date && (ranges[f.key]?.from || ranges[f.key]?.to));
  if (!terms.length && !picked.length && !ranged.length) return rows || [];

  return (rows || []).filter((row) => {
    if (terms.length) {
      const hay = field?.search ? fold(field.get(row)) : allFieldsHaystack(row);
      if (!matchesAll(hay, terms)) return false;
    }
    for (const f of picked) {
      if (!picks[f.key].includes(pickOf(f, row))) return false;
    }
    for (const f of ranged) {
      const { from, to } = ranges[f.key];
      const value = String(f.get(row) || '').slice(0, 10);
      if (!value) return false;
      if (from && value < from) return false;
      if (to && value > to) return false;
    }
    return true;
  });
}

export function isFiltering(state) {
  const { query = '', picks = {}, ranges = {} } = state || {};
  return Boolean(query.trim())
    || Object.values(picks).some((list) => (list || []).length)
    || Object.values(ranges).some((r) => r && (r.from || r.to));
}

export function optionsFrom(rows, get) {
  const seen = new Set();
  (rows || []).forEach((row) => {
    const v = String(get(row) ?? '').trim();
    if (v) seen.add(v);
  });
  return [...seen].sort((a, b) => a.localeCompare(b)).map((v) => ({ value: v, label: v }));
}
