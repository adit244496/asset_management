export const NOT_RECORDED = '—';

const PLACEHOLDERS = new Set(['n/a', 'n.a.', 'n.a', 'na']);

export function isNotRecorded(value) {
  if (value === null || value === undefined) return true;
  const clean = value.toString().trim();
  if (!clean) return true;
  return PLACEHOLDERS.has(clean.toLowerCase());
}

export function displayValue(value) {
  return isNotRecorded(value) ? NOT_RECORDED : value.toString().trim();
}

export function joinRecorded(values, separator = ' · ') {
  const kept = (values || []).filter((v) => !isNotRecorded(v))
    .map((v) => v.toString().trim());
  return kept.length ? kept.join(separator) : NOT_RECORDED;
}
