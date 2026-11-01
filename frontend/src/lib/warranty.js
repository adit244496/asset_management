import { istParts } from './dates';

export const EXPIRING_SOON_DAYS = 90;

export const WARRANTY_UNKNOWN = 'unknown';
export const WARRANTY_EXPIRED = 'expired';
export const WARRANTY_SOON = 'soon';
export const WARRANTY_OK = 'covered';

const DAY_MS = 24 * 60 * 60 * 1000;

export function parseDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec((value ?? '').toString().trim());
  if (!match) return null;
  const [, y, m, d] = match.map(Number);
  const ms = Date.UTC(y, m - 1, d);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) {
    return null;
  }
  return ms;
}

// Today's date in India, as a UTC midnight to compare with parseDate().
export function startOfToday(now = new Date()) {
  const p = istParts(now);
  return Date.UTC(p.y, p.m - 1, p.d);
}

export function daysUntilExpiry(asset, now = new Date()) {
  const end = parseDate(asset?.warrantyEnd);
  if (end === null) return null;
  return Math.round((end - startOfToday(now)) / DAY_MS);
}

export function warrantyState(asset, now = new Date()) {
  const days = daysUntilExpiry(asset, now);
  if (days === null) return WARRANTY_UNKNOWN;
  if (days < 0) return WARRANTY_EXPIRED;
  if (days <= EXPIRING_SOON_DAYS) return WARRANTY_SOON;
  return WARRANTY_OK;
}

export const WARRANTY_LABELS = {
  [WARRANTY_UNKNOWN]: 'Not recorded',
  [WARRANTY_EXPIRED]: 'Out of warranty',
  [WARRANTY_SOON]: `Expiring within ${EXPIRING_SOON_DAYS} days`,
  [WARRANTY_OK]: 'In warranty',
};

export function ageYears(asset, now = new Date()) {
  const bought = parseDate(asset?.dop);
  if (bought === null) return null;

  const from = new Date(bought);
  const to = new Date(startOfToday(now));
  let years = to.getUTCFullYear() - from.getUTCFullYear();

  const monthDiff = to.getUTCMonth() - from.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && to.getUTCDate() < from.getUTCDate())) {
    years -= 1;
  }
  return years < 0 ? 0 : years;
}

export function warrantySummary(assets, { now = new Date(), refreshAfterYears = 5 } = {}) {
  const summary = {
    [WARRANTY_UNKNOWN]: 0,
    [WARRANTY_EXPIRED]: 0,
    [WARRANTY_SOON]: 0,
    [WARRANTY_OK]: 0,
    overAge: 0,
    counted: 0,
  };

  (assets || []).forEach((asset) => {
    if (!asset || asset.isDeleted || asset.status === 'SCRAP') return;
    summary.counted += 1;
    summary[warrantyState(asset, now)] += 1;
    const age = ageYears(asset, now);
    if (age !== null && age >= refreshAfterYears) summary.overAge += 1;
  });

  return summary;
}
