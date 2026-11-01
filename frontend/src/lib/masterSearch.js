import { filterBy, haystackOf } from './textSearch';

export function masterHaystack(row) {
  if (!row) return '';
  return haystackOf(row.name, row.description);
}

export function filterMasterRows(rows, query) {
  return filterBy(rows, query, masterHaystack);
}
