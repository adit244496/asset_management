import { byKey, isNumericColumn } from './schema';

export const ASC = 'asc';
export const DESC = 'desc';

export const NORMAL = { key: null, dir: null };

export function nextSort(current, key) {
  if (!current || current.key !== key) return { key, dir: ASC };
  if (current.dir === ASC) return { key, dir: DESC };
  return NORMAL;
}

export function sortHint(current, key, label) {
  const next = nextSort(current, key);
  if (next.key === null) return `${label}: back to the normal order`;
  return next.dir === ASC ? `Sort by ${label}, ascending` : `Sort by ${label}, descending`;
}

export function ariaSort(current, key) {
  if (!current || current.key !== key) return 'none';
  return current.dir === ASC ? 'ascending' : 'descending';
}

export function sortGlyph(current, key) {
  if (!current || current.key !== key) return '⇅';
  return current.dir === ASC ? '▲' : '▼';
}

function compareBy(key) {
  const col = byKey(key);
  if (isNumericColumn(col)) {
    return (a, b) => (parseFloat(a[key]) || 0) - (parseFloat(b[key]) || 0);
  }
  if (col && col.type === 'date') {
    return (a, b) => {
      const av = a[key] || '';
      const bv = b[key] || '';
      return av < bv ? -1 : (av > bv ? 1 : 0);
    };
  }
  return (a, b) => {
    const av = (a[key] ?? '').toString().toLowerCase();
    const bv = (b[key] ?? '').toString().toLowerCase();
    return av < bv ? -1 : (av > bv ? 1 : 0);
  };
}

const bySrl = compareBy('srl');
const byAssetId = compareBy('assetId');
const normalCompare = (a, b) => bySrl(a, b) || byAssetId(a, b);

export function sortRows(rows, current) {
  const normal = [...(rows || [])].sort(normalCompare);
  if (!current || !current.key) return normal;
  const cmp = compareBy(current.key);
  const sign = current.dir === DESC ? -1 : 1;
  return normal.sort((a, b) => sign * cmp(a, b));
}
