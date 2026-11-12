import { filterBy, haystackOf } from './textSearch';

const IN_STOCK = /^in[\s_-]*stock$/i;

export function isInStock(status) {
  return IN_STOCK.test((status ?? '').toString().trim());
}

const IN_USE = /^in[\s_-]*use$/i;

// An Assigned Date belongs to being In Use (backend crud.note_assigned_date).
export function isInUse(status) {
  return IN_USE.test((status ?? '').toString().trim());
}

export function inStockOnly(rows) {
  return (rows || []).filter((r) => r && !r.isDeleted && isInStock(r.status));
}

export function countByType(rows) {
  const counts = new Map();
  (rows || []).forEach((r) => {
    const type = (r?.type ?? '').toString().trim() || 'Not recorded';
    counts.set(type, (counts.get(type) || 0) + 1);
  });
  return [...counts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}

export function stockHaystack(row) {
  if (!row) return '';
  return haystackOf(row.assetId, row.assetTag, row.type, row.model, row.srl,
    row.serviceTag, row.location, row.company, row.description);
}

export function filterStock(rows, query) {
  return filterBy(rows, query, stockHaystack);
}
