import api from '../api';
import { formatDate, formatIfDate, istParts, todayIST } from './dates';
import { pickColumns } from './exporters';

export const PDF_DEFAULT_COLUMNS = [
  'assetId', 'assetTag', 'type', 'model', 'status', 'user', 'linkedAssetText',
  'location', 'department', 'dop', 'warrantyEnd',
];

export const PDF_SOFTWARE_COLUMNS = [
  'assetTag', 'version', 'status', 'quantity', 'warrantyEnd', 'price', 'vendor', 'poNo',
];

export const QR_LIMIT = 250;

export async function fetchReportRows(card, use) {
  const res = await api.post('/assistant/report-rows', {
    spec: card.spec,
    title: card.title || '',
    use,
  });
  return res.data;
}

export function reportFilename(title, ext, now = new Date()) {
  const slug = String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'assistant-report';
  return `${slug}-${todayIST(now)}.${ext}`;
}

export function pdfColumns(register, columnKeys) {
  const fallback = register === 'software' ? PDF_SOFTWARE_COLUMNS : PDF_DEFAULT_COLUMNS;
  return pickColumns(register, columnKeys && columnKeys.length ? columnKeys : fallback);
}

export function openInReportState(card, rows) {
  return {
    assistantReport: {
      title: card.title || '',
      register: card.register,
      ids: (rows || []).map((r) => r.id),
    },
  };
}

export function historyWhen(iso, now = new Date()) {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const p = istParts(at);
  const time = `${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}`;
  const dayOf = (d) => { const q = istParts(d); return Date.UTC(q.y, q.m - 1, q.d); };
  const days = Math.round((dayOf(now) - dayOf(at)) / 86400000);
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Yesterday, ${time}`;
  return formatDate(at);
}

export function tableCell(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? value.toLocaleString('en-IN')
      : value.toLocaleString('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }
  return formatIfDate(String(value));
}
