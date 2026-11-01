import { formatDate, formatDateTime, todayIST } from './dates';
import { normalizeKey } from './masterFile';
import { USER_COLUMNS, mapRows, rowProblems } from './userImport';

const loadXLSX = () => import('xlsx');

const ABOUT_SHEET = 'About';
export const USERS_SHEET = 'Users';
const USER_INFO_HEADERS = ['Username', 'Profile', 'Active'];
const yesNo = (v) => (v ? 'Yes' : 'No');

const headerFor = (category) => [
  category.label, 'Description', 'Active', 'Order',
  ...(category.key === 'type' ? ['Shared'] : []),
  'In use',
];

export function workbookFilename(prefix = 'master-data', when = new Date()) {
  return `${prefix}-${todayIST(when)}.xlsx`;
}

export async function downloadMasterWorkbook(categories, items, { users = [], filename, note } = {}) {
  const XLSX = await loadXLSX();
  const wb = XLSX.utils.book_new();
  categories.forEach((category) => {
    const rows = (items?.[category.key] || []).map((r) => [
      r.name, r.description || '', yesNo(r.isActive), r.sortOrder ?? '',
      ...(category.key === 'type' ? [yesNo(r.isShared)] : []),
      r.inUse ?? '',
    ]);
    const ws = XLSX.utils.aoa_to_sheet([headerFor(category), ...rows]);
    ws['!cols'] = headerFor(category).map((h, i) => ({ wch: i === 0 ? 28 : i === 1 ? 40 : 10 }));
    XLSX.utils.book_append_sheet(wb, ws, category.plural.slice(0, 31));
  });
  const userHeader = [...USER_COLUMNS.map((c) => c.header), ...USER_INFO_HEADERS];
  const usersWs = XLSX.utils.aoa_to_sheet([userHeader, ...users.map((u) => [
    ...USER_COLUMNS.map((c) => (c.key === 'dateOfJoining' ? formatDate(u[c.key]) : u[c.key] || '')),
    u.username || '', u.role || '', yesNo(u.isActive),
  ])]);
  usersWs['!cols'] = userHeader.map((h, i) => ({ wch: [26, 32, 22, 15][i] || 14 }));
  XLSX.utils.book_append_sheet(wb, usersWs, USERS_SHEET);

  const total = categories.reduce((n, c) => n + (items?.[c.key]?.length || 0), 0);
  const about = XLSX.utils.aoa_to_sheet([
    ['IT Asset Engine — Master Data'],
    ['Saved', formatDateTime(new Date())],
    ...(note ? [['Why', note]] : []),
    ['Values', total],
    ['Users', users.length],
    [],
    ['One sheet per list, and one for Users. To fill them from this file, open Master Data and choose Upload workbook.'],
    ['Active and Shared take Yes or No. Order sets the dropdown order. In use is for reading only and is not uploaded.'],
    ['A value already in a list is updated to what the sheet says; a value not in the list is added; nothing is deleted.'],
    ['Users: matched by Email ID. Someone already on file has Email ID, Location and Date of Joining updated; someone new '
      + 'is added as an assignee on the starting password. All four columns are needed. Username, Profile and Active are '
      + 'for reading only -- a profile or password is never set from this file.'],
  ]);
  about['!cols'] = [{ wch: 14 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, about, ABOUT_SHEET);
  XLSX.writeFile(wb, filename || workbookFilename());
}

const NAME_HEADERS = ['name', 'value'];
const COLUMN_HEADERS = {
  description: ['description', 'desc'],
  isActive: ['active', 'is active', 'status (active)'],
  sortOrder: ['order', 'sort order', 'sortorder'],
  isShared: ['shared', 'is shared'],
};

export async function readMasterWorkbook(file, categories) {
  const XLSX = await loadXLSX();
  const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array', cellDates: true });
  let users = null;
  const byName = new Map();
  categories.forEach((c) => [c.plural, c.label, c.key].forEach((n) => byName.set(normalizeKey(n), c)));

  const lists = {};
  const rowNumbers = {};
  const sheets = [];
  const ignored = [];
  wb.SheetNames.forEach((sheetName) => {
    if (normalizeKey(sheetName) === normalizeKey(USERS_SHEET) && !users) {
      const raw = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '', raw: true });
      users = { rows: [], rowNumbers: [], sheetName, signInLeftOut: 0 };
      raw.forEach((r) => {
        const [row] = mapRows([r]).rows;
        if (!row) return;
        const profileKey = Object.keys(r).find((h) => normalizeKey(h) === 'profile');
        const profile = String(profileKey ? r[profileKey] : '').trim().toLowerCase();
        if (profile && profile !== 'assignee' && rowProblems(row).length) {
          users.signInLeftOut += 1;
          return;
        }
        users.rows.push(row);
        users.rowNumbers.push((r.__rowNum__ ?? 0) + 1);
      });
      return;
    }
    const category = byName.get(normalizeKey(sheetName));
    if (!category || lists[category.key]) {
      if (normalizeKey(sheetName) !== normalizeKey(ABOUT_SHEET)) ignored.push(sheetName);
      return;
    }
    const matrix = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
      header: 1, defval: '', raw: false, blankrows: true,
    });
    const header = (matrix[0] || []).map(normalizeKey);
    const find = (names) => header.findIndex((h) => names.includes(h));
    let nameCol = find([normalizeKey(category.label), normalizeKey(category.plural), ...NAME_HEADERS]);
    if (nameCol < 0) nameCol = 0;
    const cols = Object.fromEntries(Object.entries(COLUMN_HEADERS).map(([k, names]) => [k, find(names)]));

    const entries = [];
    const numbers = [];
    matrix.slice(1).forEach((row, i) => {
      if (!(row || []).some((cell) => String(cell ?? '').trim())) return;
      const entry = { name: String(row[nameCol] ?? '').trim() };
      Object.entries(cols).forEach(([k, idx]) => {
        if (idx >= 0) entry[k] = String(row[idx] ?? '').trim();
      });
      if (category.key !== 'type') delete entry.isShared;
      entries.push(entry);
      numbers.push(i + 2);
    });
    lists[category.key] = entries;
    rowNumbers[category.key] = numbers;
    sheets.push({ key: category.key, plural: category.plural, sheetName, count: entries.length });
  });
  return { lists, sheets, ignored, rowNumbers, users };
}
