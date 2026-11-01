import {
  DATA_SHEET_NAME,
  GUIDE_SHEET_NAME,
  fieldGuideWidths,
  templateColumnWidths,
  templateColumns,
  templateFieldGuideRows,
  templateHeaderRow,
  withUploadColumns,
} from './assetTemplate';
import { formatDate, formatDateTime } from './dates';
import { ASSET, registerOf } from './registers';
import { columnsFor, exportColumnsFor } from './schema';

const loadXLSX = () => import('xlsx');

export function pickColumns(register = ASSET, columnKeys = null) {
  if (!columnKeys || !columnKeys.length) return exportColumnsFor(register);
  const all = columnsFor(register);
  return columnKeys.map((key) => all.find((col) => col.key === key)).filter(Boolean);
}

export function toExportRows(rows, register = ASSET, columnKeys = null) {
  const columns = pickColumns(register, columnKeys);
  return rows.map((r) => {
    const o = {};
    columns.forEach((col) => {
      o[col.label] = col.type === 'date' ? formatDate(r[col.key]) : (r[col.key] ?? '');
    });
    return o;
  });
}

export function rowsToCSV(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(',')];
  rows.forEach((r) => {
    lines.push(headers.map((h) => {
      const v = (r[h] ?? '').toString().replace(/"/g, '""');
      return /[",\n]/.test(v) ? `"${v}"` : v;
    }).join(','));
  });
  return lines.join('\n');
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportCSV(rows, register = ASSET, filename = null, columnKeys = null) {
  const exportRows = toExportRows(rows, register, columnKeys);
  if (!exportRows.length) return;
  const name = filename || `${registerOf(register).path}-register-export.csv`;
  downloadBlob(new Blob([rowsToCSV(exportRows)], { type: 'text/csv;charset=utf-8;' }), name);
}

export async function exportXLSX(rows, register = ASSET, filename = null, columnKeys = null) {
  const exportRows = toExportRows(rows, register, columnKeys);
  if (!exportRows.length) return;
  const meta = registerOf(register);
  const XLSX = await loadXLSX();
  const ws = XLSX.utils.json_to_sheet(exportRows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `${meta.label.slice(0, 28)} Register`);
  XLSX.writeFile(wb, filename || `${meta.path}-register-export.xlsx`);
}

export async function exportTableXLSX({ header, rows, footer }, filename, sheetName = 'Summary') {
  const XLSX = await loadXLSX();
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows, ...(footer ? [footer] : [])]);
  ws['!cols'] = header.map((h, i) => ({ wch: i === 0 ? 28 : Math.max(10, String(h).length + 2) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  XLSX.writeFile(wb, filename);
}

export function exportActivityCSV(rows, filename) {
  if (!rows.length) return;
  downloadBlob(new Blob([rowsToCSV(rows)], { type: 'text/csv;charset=utf-8;' }), filename);
}

export async function exportActivityXLSX(rows, filename, description = '') {
  if (!rows.length) return;
  const XLSX = await loadXLSX();
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [
    { wch: 20 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 52 },
    { wch: 22 }, { wch: 10 }, { wch: 15 }, { wch: 14 }, { wch: 24 },
    { wch: 24 }, { wch: 22 }, { wch: 14 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Activity Log');
  if (description) {
    const about = XLSX.utils.aoa_to_sheet([
      ['IT Asset Engine — Activity Log'],
      ['Exported', formatDateTime(new Date())],
      ['Filters', description],
      ['Entries', rows.length],
    ]);
    about['!cols'] = [{ wch: 14 }, { wch: 80 }];
    XLSX.utils.book_append_sheet(wb, about, 'About this export');
  }
  XLSX.writeFile(wb, filename);
}

const WHY_FAILED_COLUMN = 'Why it was not imported';
const WHAT_CHANGED_COLUMN = 'What was changed on import';
const ROW_COLUMN = 'Row in the upload';

export const FAILED_SHEET_NAME = 'Fix and re-upload';
export const CLEANED_SHEET_NAME = 'Imported with changes';

export async function exportImportReport(report, filename, register = ASSET) {
  const XLSX = await loadXLSX();
  const cols = templateColumns(columnsFor(register));

  const sheetFor = (entries, reasonHeader) => {
    const header = [...cols.map((c) => c.label), ROW_COLUMN, reasonHeader];
    const body = (entries || []).map((entry) => {
      const row = report?.posted?.[entry.row] || {};
      return [
        ...cols.map((c) => row[c.key] ?? ''),
        entry.row + 1,
        entry.reason,
      ];
    });
    const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
    ws['!cols'] = [...templateColumnWidths(columnsFor(register)), { wch: 16 }, { wch: 70 }];
    return ws;
  };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheetFor(report?.errors, WHY_FAILED_COLUMN),
    FAILED_SHEET_NAME);
  if (report?.warnings?.length) {
    XLSX.utils.book_append_sheet(wb, sheetFor(report.warnings, WHAT_CHANGED_COLUMN),
      CLEANED_SHEET_NAME);
  }
  XLSX.writeFile(wb, filename || `${registerOf(register).path}-not-imported.xlsx`);
}

export async function exportTemplate(optionsFor, register = ASSET, filename = null) {
  const XLSX = await loadXLSX();
  const columns = withUploadColumns(columnsFor(register), register);

  const dataSheet = XLSX.utils.aoa_to_sheet([templateHeaderRow(columns)]);
  dataSheet['!cols'] = templateColumnWidths(columns);

  const guideSheet = XLSX.utils.aoa_to_sheet(templateFieldGuideRows(columns, optionsFor, register));
  guideSheet['!cols'] = fieldGuideWidths(columns);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, dataSheet, DATA_SHEET_NAME);
  XLSX.utils.book_append_sheet(wb, guideSheet, GUIDE_SHEET_NAME);
  XLSX.writeFile(wb, filename || `${registerOf(register).path}-register-template.xlsx`);
}
