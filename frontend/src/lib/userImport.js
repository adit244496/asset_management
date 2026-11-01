import { toISODate } from './parser';
import { normalizeHeader } from './schema';

export const USER_COLUMNS = [
  { key: 'fullName', header: 'Full Name', aliases: ['full name', 'name', 'employee name', 'person'] },
  { key: 'email', header: 'Email ID', aliases: ['email id', 'email', 'e-mail', 'mail', 'email address'] },
  { key: 'location', header: 'Location', aliases: ['location', 'office', 'work location'] },
  { key: 'dateOfJoining', header: 'Date of Joining',
    aliases: ['date of joining', 'doj', 'joining date', 'date joined'] },
];

export const TEMPLATE_FILENAME = 'user-upload-template.csv';

export function templateCsv() {
  return `${USER_COLUMNS.map((c) => c.header).join(',')}\r\n`;
}

export function downloadTemplate() {
  const blob = new Blob(['﻿', templateCsv()], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = TEMPLATE_FILENAME;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const HEADER_INDEX = (() => {
  const index = {};
  USER_COLUMNS.forEach((c) => {
    [c.header, ...c.aliases].forEach((h) => { index[normalizeHeader(h)] = c.key; });
  });
  return index;
})();

export function mapRows(json) {
  const unmatched = new Set();
  const rows = json.map((raw) => {
    const out = {};
    Object.keys(raw).forEach((h) => {
      const key = HEADER_INDEX[normalizeHeader(h)];
      if (!key) {
        if (normalizeHeader(h) && !/^__empty/i.test(h)) unmatched.add(h);
        return;
      }
      const value = raw[h];
      out[key] = key === 'dateOfJoining'
        ? toISODate(value)
        : (value === undefined || value === null ? '' : String(value).trim());
      if (key === 'dateOfJoining' && !out[key] && String(value ?? '').trim()) {
        out[key] = String(value).trim();
      }
    });
    return out;
  }).filter((r) => Object.values(r).some((v) => v));
  return { rows, unmatchedHeaders: [...unmatched] };
}

export async function parseUserFile(file) {
  const XLSX = await import('xlsx');
  const data = new Uint8Array(await file.arrayBuffer());
  const wb = XLSX.read(data, { type: 'array', cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return mapRows(XLSX.utils.sheet_to_json(sheet, { defval: '', raw: true }));
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export function rowProblems(row) {
  const missing = USER_COLUMNS.filter((c) => !(row[c.key] || '').trim()).map((c) => c.header);
  const problems = missing.length ? [`${missing.join(', ')} missing`] : [];
  if (row.email && !EMAIL_RE.test(row.email)) problems.push('Email ID is not valid');
  if (row.dateOfJoining && !ISO_RE.test(row.dateOfJoining)) problems.push('Date of Joining is not a date');
  return problems;
}
