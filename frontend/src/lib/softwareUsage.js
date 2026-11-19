import { licenceExpired } from './warranty';

// The one rule for a software's Usage (its status field): once its Renewal
// Date has passed it is Expired, and Expired shows no Usage -- "—" -- on every
// screen. The server sends `expired` (crud.licence_expired); the Renewal Date
// is the fallback for a record without it. A scrapped software keeps SCRAP.
// Use StatusBadge with `record` (it applies this), or shownUsage() for text.

export function isExpiredSoftware(record, registerKey = record?.register) {
  if (!record || registerKey !== 'software' || record.isDeleted) return false;
  if (typeof record.expired === 'boolean') return record.expired;
  return licenceExpired(record);
}

// The Usage to show: '' for an expired software, otherwise its status.
export function shownUsage(record, registerKey = record?.register) {
  return isExpiredSoftware(record, registerKey) ? '' : (record?.status ?? '');
}
