import { formatDate, formatDateTime, formatIfDate, todayIST } from './dates';
import { fieldLabel } from './historyGroups';

export const CATEGORY_LABELS = {
  auth: 'Passwords',
  users: 'Accounts',
  masters: 'Master data',
  asset: 'Assets',
  peripheral: 'Peripherals',
  software: 'Softwares',
  verification: 'Verification',
  assistant: 'Assistant',
  notifications: 'Email & approvals',
  data: 'All data',
  assets: 'Assets',
  peripherals: 'Peripherals',
  softwares: 'Softwares',
};

export const categoryLabel = (key) => CATEGORY_LABELS[key] || key || '—';

export const OUTCOME_LABELS = {
  ok: 'Done',
  refused: 'Refused',
  failed: 'Failed',
};

export const outcomeLabel = (key) => OUTCOME_LABELS[key] || key || '—';

export const OUTCOME_TONE = {
  ok: 'var(--good)',
  refused: 'var(--warning, var(--critical))',
  failed: 'var(--critical)',
};

export const outcomeTone = (key) => OUTCOME_TONE[key] || 'var(--text-muted)';

export const SOURCE_LABELS = {
  activity: 'Action',
  register: 'Register change',
};

export const sourceLabel = (key) => SOURCE_LABELS[key] || key || '—';

export const formatWhen = (iso) => formatDateTime(iso, { seconds: true });

export const formatWhenExact = (iso) => formatDateTime(iso, { seconds: true, clock24: true });

export const dash = (v) => {
  const clean = (v ?? '').toString().trim();
  return clean || '—';
};

export const roleLabel = (row) => {
  if (!row.actorRole) return '—';
  return row.actorRoleIsCurrent ? `${row.actorRole} (current)` : row.actorRole;
};

export function changeText(row) {
  if (row.source === 'register' && row.action === 'verified' && row.field === 'sapId') {
    return `Into the register without verification — it has SAP ID ${dash(row.newValue)}`;
  }
  if (row.source === 'register' && row.field) {
    return `${fieldLabel(row.field, row.category)}: ${dash(formatIfDate(row.oldValue))} → ${dash(formatIfDate(row.newValue))}`;
  }
  return dash(row.summary);
}

export function subjectOf(row) {
  return row.source === 'register' && row.field ? row.target || null : null;
}

export const ACTIVITY_COLUMNS = [
  { key: 'When', get: (r) => formatWhenExact(r.at), screen: (r) => formatWhen(r.at) },
  { key: 'Who', get: (r) => dash(r.actor) },
  { key: 'Area', get: (r) => categoryLabel(r.category) },
  { key: 'What happened', get: (r) => dash(r.summary) },
  { key: 'Subject', get: (r) => dash(r.target) },
  { key: 'Outcome', get: (r) => outcomeLabel(r.outcome) },
  { key: 'Kind', get: (r) => sourceLabel(r.source) },
  { key: 'Field', get: (r) => dash(r.field) },
  { key: 'From', get: (r) => dash(formatIfDate(r.oldValue)) },
  { key: 'To', get: (r) => dash(formatIfDate(r.newValue)) },
  { key: 'Action', get: (r) => dash(r.action) },
  { key: 'IP address', get: (r) => dash(r.ip) },
];

export function toRows(items) {
  return (items || []).map((item) => {
    const row = {};
    ACTIVITY_COLUMNS.forEach((col) => { row[col.key] = col.get(item); });
    return row;
  });
}

export function describeFilters(filters = {}) {
  const parts = [];
  if (filters.q) parts.push(`matching "${filters.q}"`);
  if (filters.actor) parts.push(`by ${filters.actor}`);
  if (filters.category) parts.push(categoryLabel(filters.category).toLowerCase());
  if (filters.outcome) parts.push(outcomeLabel(filters.outcome).toLowerCase());
  if (filters.from) parts.push(`from ${formatDate(filters.from)}`);
  if (filters.to) parts.push(`to ${formatDate(filters.to)}`);
  return parts.length ? parts.join(', ') : 'no filters — the complete log';
}

export function exportFilename(extension) {
  const stamp = todayIST();
  return `activity-log-${stamp}.${extension}`;
}
