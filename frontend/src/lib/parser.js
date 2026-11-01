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

export function toISODate(value) {
  if (value === null || value === undefined || value === '') return '';
  if (value instanceof Date && !isNaN(value)) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'number') {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const d = new Date(epoch.getTime() + value * 86400000);
    if (!isNaN(d)) return d.toISOString().slice(0, 10);
    return '';
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
  const parsed = new Date(s);
  if (!isNaN(parsed)) return parsed.toISOString().slice(0, 10);
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
        const wb = XLSX.read(data, { type: 'array', cellDates: true });
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
                out[key] = toISODate(val);
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
