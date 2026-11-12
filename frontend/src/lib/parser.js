import { UPLOAD_ONLY_COLUMNS } from './assetTemplate';
import { REGISTER_KEYS } from './registers';
import { COLUMNS, byKey, columnsFor, normalizeHeader } from './schema';

const columnFor = (key) => byKey(key) || UPLOAD_ONLY_COLUMNS.find((c) => c.key === key);

const loadXLSX = () => import('xlsx');

function buildHeaderIndex() {
  const index = {};
  [...COLUMNS, ...UPLOAD_ONLY_COLUMNS].forEach((col) => {
    (col.headerAliases || []).forEach((alias) => {
      index[normalizeHeader(alias)] = col.key;
    });
    index[normalizeHeader(col.label)] = col.key;
  });
  REGISTER_KEYS.forEach((reg) => {
    columnsFor(reg).forEach((col) => {
      const h = normalizeHeader(col.label);
      if (!index[h]) index[h] = col.key;
    });
  });
  return index;
}

function pad(n) {
  const s = String(n);
  return s.length < 2 ? `0${s}` : s;
}

const DAY_MS = 86400000;
// Excel's day 0 (1900 date system). Day numbers are counted in plain calendar
// days, so they are converted with UTC arithmetic only: no time zone may ever
// touch them, or a date entered as 15-09-2026 becomes 14-09-2026 in India
// (local midnight, UTC+5:30, is the previous day in UTC).
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
// Workbooks saved in the 1904 date system (old Mac Excel) count from 1904.
const DAYS_1900_TO_1904 = 1462;

const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

// True when the workbook uses the 1904 date system.
export function uses1904(workbook) {
  return Boolean(workbook?.Workbook?.WBProps?.date1904);
}

// Options for XLSX.read: cells keep Excel's day numbers (no cellDates), which
// toISODate turns into dates without a time-zone shift. A new object each
// time -- XLSX.read writes into the options it is given.
export const readOptions = () => ({ type: 'array', cellDates: false });

export function toISODate(value, { date1904 = false } = {}) {
  if (value === null || value === undefined || value === '') return '';
  if (value instanceof Date && !isNaN(value)) {
    // A date made in this browser stands for that calendar day here: read
    // its local fields, never toISOString() (that is UTC, a day early in IST).
    return ymd(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 1 || value > 2958465) return '';
    // Whole days only (a time of day is ignored). The small allowance absorbs
    // floating-point noise such as 45915.9999999 for 45916.
    const days = Math.floor(value + 1e-7) + (date1904 ? DAYS_1900_TO_1904 : 0);
    const d = new Date(EXCEL_EPOCH_MS + days * DAY_MS);
    return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  const s = String(value).trim();
  if (!s) return '';
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (iso) {
    return `${iso[1]}-${pad(iso[2])}-${pad(iso[3])}`;
  }
  const dm = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/.exec(s);
  if (dm) {
    const day = parseInt(dm[1], 10);
    const mon = parseInt(dm[2], 10);
    let yr = parseInt(dm[3], 10);
    if (yr < 100) yr += yr < 70 ? 2000 : 1900;
    if (mon >= 1 && mon <= 12 && day >= 1 && day <= 31) {
      return `${yr}-${pad(mon)}-${pad(day)}`;
    }
  }
  // Anything else ("15 Sep 2026", "Sep 15, 2026"): the browser reads it as
  // local midnight, so take the local calendar fields.
  const parsed = new Date(s);
  if (!isNaN(parsed)) return ymd(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate());
  return '';
}

export async function parseFile(file) {
  const XLSX = await loadXLSX();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const wb = XLSX.read(data, readOptions());
        const date1904 = uses1904(wb);
        const sheetName = wb.SheetNames[0];
        const sheet = wb.Sheets[sheetName];
        const json = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: true });
        const headerIndex = buildHeaderIndex();
        const unmatched = {};

        const rows = json
          .map((rawRow) => {
            const out = {};
            Object.keys(rawRow).forEach((h) => {
              const norm = normalizeHeader(h);
              const key = headerIndex[norm];
              if (!key) {
                if (norm) unmatched[h] = true;
                return;
              }
              const col = columnFor(key);
              const val = rawRow[h];
              if (col.type === 'date') {
                out[key] = toISODate(val, { date1904 });
              } else {
                out[key] = val === undefined || val === null ? '' : String(val).trim();
              }
            });
            return out;
          })
          .filter((r) => Object.keys(r).some((k) => r[k]));

        resolve({
          rows,
          unmatchedHeaders: Object.keys(unmatched),
          sheetName,
          rawRowCount: json.length,
        });
      } catch (err) {
        reject(err);
      }
    };
    reader.readAsArrayBuffer(file);
  });
}
