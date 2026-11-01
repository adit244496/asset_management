// Dates are stored and sent as yyyy-mm-dd (and timestamps as ISO, UTC); every
// date a person sees or types is dd-mm-yyyy, and every time and "today" is
// Indian Standard Time -- never the viewer's own time zone. India has no
// daylight saving, so a fixed +05:30 is exact.
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const TYPED = /^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{4})$/;
const pad = (n) => String(n).padStart(2, '0');
const IST_OFFSET_MS = 330 * 60 * 1000;

// The IST wall clock for an instant (default: now).
export function istParts(value = new Date()) {
  const at = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(at.getTime())) return null;
  const s = new Date(at.getTime() + IST_OFFSET_MS);
  return {
    y: s.getUTCFullYear(), m: s.getUTCMonth() + 1, d: s.getUTCDate(),
    h: s.getUTCHours(), mi: s.getUTCMinutes(), s: s.getUTCSeconds(),
  };
}

// Today in India, yyyy-mm-dd.
export function todayIST(now = new Date()) {
  const p = istParts(now);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

// Today in India as a Date at local midnight, for calendar arithmetic
// (setDate, new Date(y, m, 1) ...) that reads local fields.
export function istTodayLocal(now = new Date()) {
  const p = istParts(now);
  return new Date(p.y, p.m - 1, p.d);
}

const realDay = (y, m, d) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};

export function formatDate(value) {
  if (value === null || value === undefined || value === '') return '';
  if (value instanceof Date) {
    const p = istParts(value);
    return p ? `${pad(p.d)}-${pad(p.m)}-${p.y}` : '';
  }
  const text = String(value).trim();
  const day = ISO_DAY.exec(text);
  if (day) return `${day[3]}-${day[2]}-${day[1]}`;
  if (/^\d{4}-\d{2}-\d{2}[T ]\d/.test(text)) return formatDate(new Date(text.replace(' ', 'T')));
  return text;
}

export function formatDateTime(value, { seconds = false, clock24 = false } = {}) {
  if (!value) return '';
  const p = istParts(value);
  if (!p) return String(value);
  const day = `${pad(p.d)}-${pad(p.m)}-${p.y}`;
  const secs = seconds ? `:${pad(p.s)}` : '';
  if (clock24) return `${day} ${pad(p.h)}:${pad(p.mi)}${secs}`;
  const ampm = p.h >= 12 ? 'pm' : 'am';
  const h = p.h % 12 || 12;
  return `${day}, ${pad(h)}:${pad(p.mi)}${secs} ${ampm}`;
}

// Only text that is exactly a stored date changes; anything else is returned as is.
export function formatIfDate(value) {
  return typeof value === 'string' && ISO_DAY.test(value.trim()) ? formatDate(value) : value;
}

// dd-mm-yyyy (or dd/mm/yyyy, d.m.yyyy, or an already-stored yyyy-mm-dd) -> yyyy-mm-dd;
// null when it is not a real date.
export function parseDate(text) {
  const s = String(text ?? '').trim();
  const iso = ISO_DAY.exec(s);
  if (iso) return realDay(+iso[1], +iso[2], +iso[3]) ? s : null;
  const m = TYPED.exec(s);
  if (!m) return null;
  const d = +m[1]; const mo = +m[2]; const y = +m[3];
  return realDay(y, mo, d) ? `${y}-${pad(mo)}-${pad(d)}` : null;
}

export const isStoredDate = (value) => ISO_DAY.test(String(value ?? '').trim());
