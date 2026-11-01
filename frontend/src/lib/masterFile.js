const loadXLSX = () => import('xlsx');

export const ACCEPTED_EXTENSIONS = /\.(xlsx|xls|csv)$/i;

export function normalizeKey(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function readSheetMatrix(file) {
  const XLSX = await loadXLSX();
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' });
  const sheetName = wb.SheetNames[0];
  const matrix = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
    header: 1,
    defval: '',
    raw: false,
    blankrows: false,
  });
  return { sheetName, sheetNames: wb.SheetNames, matrix };
}

export function looksLikeHeaderRow(row, valueCandidates = []) {
  if (!Array.isArray(row) || !row.length) return false;
  const known = new Set([
    ...valueCandidates.map(normalizeKey),
    'name', 'value', 'code', 'label', 'title',
    'description', 'desc', 'details', 'remarks', 'notes', 'comment', 'comments',
  ].filter(Boolean));
  return row.some((cell) => known.has(normalizeKey(cell)));
}

export function buildColumns(matrix, hasHeader) {
  const rows = Array.isArray(matrix) ? matrix : [];
  const width = rows.reduce((max, row) => Math.max(max, row?.length || 0), 0);
  const headerRow = hasHeader ? (rows[0] || []) : [];
  const headers = Array.from({ length: width }, (_, i) => {
    const label = hasHeader ? String(headerRow[i] ?? '').trim() : '';
    return { index: i, label: label || `Column ${String.fromCharCode(65 + (i % 26))}` };
  });
  return { headers, dataRows: hasHeader ? rows.slice(1) : rows };
}

export function guessValueIndex(headers, valueCandidates = []) {
  const wanted = valueCandidates.map(normalizeKey).filter(Boolean);
  const generic = ['name', 'value', 'code', 'label', 'title'];

  for (const list of [wanted, generic]) {
    const hit = headers.find((h) => list.includes(normalizeKey(h.label)));
    if (hit) return hit.index;
  }
  return headers.length ? headers[0].index : -1;
}

export function guessDescriptionIndex(headers, valueIndex) {
  const wanted = ['description', 'desc', 'details', 'remarks', 'notes'];
  const hit = headers.find((h) => h.index !== valueIndex && wanted.includes(normalizeKey(h.label)));
  return hit ? hit.index : -1;
}

export function entriesFromRows(dataRows, valueIndex, descriptionIndex = -1) {
  const seen = new Set();
  const entries = [];
  let scanned = 0;

  (dataRows || []).forEach((row) => {
    const name = String(row?.[valueIndex] ?? '').trim();
    if (!name) return;
    scanned += 1;

    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);

    const description = descriptionIndex >= 0
      ? String(row?.[descriptionIndex] ?? '').trim()
      : '';
    entries.push({ name, description });
  });

  return { entries, scanned, distinct: entries.length };
}
