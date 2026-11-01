import { useCallback, useRef, useState } from 'react';
import { Download, UploadCloud } from 'lucide-react';
import { errorMessage } from '../api';
import { useAssets } from '../context/AssetsContext';
import { useMasters } from '../context/MastersContext';
import { formatIfDate } from '../lib/dates';
import { exportImportReport, exportTemplate } from '../lib/exporters';
import { parseFile } from '../lib/parser';
import { ASSET, SOFTWARE } from '../lib/registers';
import { byKeyFor } from '../lib/schema';
import { findUnknownMasters } from '../lib/unknownMasters';
import { notifyVerificationChanged } from '../lib/verification';
import UnknownMastersDialog from './UnknownMastersDialog';
import PoReminderDialog from './PoReminderDialog';
import './BulkUpload.css';

const PREVIEW_COLUMNS = ['assetTag', 'type', 'model', 'user', 'site', 'status'];
const PREVIEW_COLUMNS_PERIPHERAL = ['assetTag', 'type', 'model', 'srl', 'site', 'status'];
const PREVIEW_COLUMNS_SOFTWARE = ['assetTag', 'version', 'status', 'quantity', 'warrantyEnd', 'vendor'];
const PREVIEW_ROWS = 8;
const REPORT_LIMIT = 25;
const DEDUPE_CHOICES = [
  { value: '', label: 'Skip records already in the register (recommended)' },
  { value: 'srl', label: 'Match on Srl No. only' },
  { value: 'poNo', label: 'Match on PO No. only' },
  { value: 'assetTag', label: 'Match on Computer / Asset Name only — not unique, can drop assets' },
  { value: 'none', label: 'Import everything, even duplicates' },
];

const BulkUpload = () => {
  const { bulkImport, formOptionsFor, register, meta } = useAssets();
  const { categoriesFor, namesFor } = useMasters();
  const isAssets = register === ASSET;
  const previewColumns = isAssets ? PREVIEW_COLUMNS
    : register === SOFTWARE ? PREVIEW_COLUMNS_SOFTWARE : PREVIEW_COLUMNS_PERIPHERAL;
  const fileInputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const [status, setStatus] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [fileName, setFileName] = useState('');
  const [dedupeKey, setDedupeKey] = useState('');
  const [createUsers, setCreateUsers] = useState(false);
  const [importing, setImporting] = useState(false);
  const [report, setReport] = useState(null);
  const [unknown, setUnknown] = useState(null);
  const [noPo, setNoPo] = useState(null);

  const unknownIn = useCallback((rows) => {
    const lists = categoriesFor(register);
    const fieldOf = (c) => c.field || c.key;
    return findUnknownMasters(
      rows,
      Object.fromEntries(lists.map((c) => [fieldOf(c), namesFor(c.key)])),
      lists.map(fieldOf),
      (key) => lists.find((c) => fieldOf(c) === key)?.label || key,
    );
  }, [categoriesFor, namesFor, register]);

  const handleFile = async (file) => {
    if (!file) return;
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
      setStatus({ text: 'Unsupported file type. Please upload .xlsx, .xls, or .csv.', kind: 'error' });
      setParsed(null);
      return;
    }

    setStatus({ text: `Parsing ${file.name}…`, kind: 'info' });
    setFileName(file.name);
    setReport(null);
    try {
      const result = await parseFile(file);
      if (!result.rows.length) {
        setStatus({
          text: `No usable rows found in ${file.name}. Check that it has a header row matching the Asset Register columns.`,
          kind: 'error',
        });
        setParsed(null);
        return;
      }
      setParsed(result);
      setStatus(null);
    } catch (err) {
      setStatus({ text: `Could not parse this file: ${err.message}`, kind: 'error' });
      setParsed(null);
    }
  };

  const handleTemplate = async () => {
    try {
      await exportTemplate(formOptionsFor, register);
    } catch (err) {
      setStatus({ text: `Could not build the template: ${err.message}`, kind: 'error' });
    }
  };

  const runImport = async (unknownMasters) => {
    if (!parsed?.rows?.length) return;
    setUnknown(null);
    setImporting(true);
    const posted = parsed.rows;
    try {
      const result = await bulkImport(posted, dedupeKey || null, createUsers, unknownMasters);
      const skippedNote = result.skipped ? `, skipped ${result.skipped}` : '';
      const accountNote = result.accounts
        ? ` Created ${result.accounts.created.length} user record(s).`
          + (result.accounts.joiningDatesFilled
            ? ` Added a joining date to ${result.accounts.joiningDatesFilled} existing one(s).` : '')
        : '';
      const added = Object.values(result.unknownMasters || {})
        .reduce((n, values) => n + values.length, 0);
      const masterNote = added
        ? (unknownMasters === 'reject'
          ? ` ${added} value(s) were not in the master data; rows using them were skipped.`
          : ` ${added} new value(s) added to the master data.`)
        : '';
      const fixed = Object.values(result.normalised || {})
        .reduce((n, pairs) => n + pairs.length, 0);
      const spellingNote = fixed
        ? ` ${fixed} value(s) were recorded using the master data's spelling.`
        : '';
      const bySap = result.acceptedBySapId || 0;
      const waiting = result.added - bySap;
      const where = result.awaitingVerification
        ? `${skippedNote}.`
          + (bySap
            ? ` ${bySap} ${bySap === 1 ? 'has' : 'have'} a SAP ID, so went straight into the `
              + `${meta.one} register without verification. The other ${waiting} `
              + `${waiting === 1 ? 'is' : 'are'} waiting in Verification`
            : ' They are waiting in Verification')
          + ` and join the ${meta.one} register once another verifier has checked them.`
        : `${skippedNote} into the ${meta.one} register.`
          + (bySap
            ? ` ${bySap === result.added ? (bySap === 1 ? 'It has' : 'They have') : `${bySap} ${bySap === 1 ? 'has' : 'have'}`}`
              + ' a SAP ID, so skipped Verification.'
            : '');
      setStatus({
        text: `Imported ${result.added} record(s)${where}`
          + `${accountNote}${masterNote}${spellingNote}`,
        kind: result.skipped ? 'info' : 'success',
      });
      notifyVerificationChanged();
      setCreateUsers(false);
      setReport({ ...result, posted, fileName });
      setParsed(null);
      setFileName('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      setStatus({ text: errorMessage(err, 'Import failed.'), kind: 'error' });
    } finally {
      setImporting(false);
    }
  };

  const doImport = () => {
    if (!parsed?.rows?.length) return;
    const missing = parsed.rows
      .map((row, i) => (String(row.poNo ?? '').trim() ? null
        : [row.srl, row.assetTag, row.model || row.version || row.description]
          .filter(Boolean).join(' — ') || `Record ${i + 1} (no name)`))
      .filter(Boolean);
    if (missing.length) {
      setNoPo(missing);
      return;
    }
    afterPoReminder();
  };

  const afterPoReminder = () => {
    setNoPo(null);
    const found = unknownIn(parsed.rows);
    if (found.length) {
      setUnknown(found);
      return;
    }
    runImport('include');
  };

  const describeRow = (index) => {
    const row = report?.posted?.[index];
    if (!row) return `Row ${index + 1}`;
    const label = [row.assetTag, row.model || row.description].filter(Boolean).join(' — ');
    return label || (row.srl ? `Srl ${row.srl}` : `Row ${index + 1}`);
  };

  const downloadRejected = async () => {
    const base = (report?.fileName || meta.many).replace(/\.(xlsx|xls|csv)$/i, '');
    try {
      await exportImportReport(report, `${base} - not imported.xlsx`, register);
    } catch (err) {
      setStatus({ text: errorMessage(err, 'Could not build the file.'), kind: 'error' });
    }
  };

  const unmatchedNote = (() => {
    const headers = parsed?.unmatchedHeaders || [];
    if (!headers.length) return '';
    const shown = headers.slice(0, 6).join(', ');
    return ` ${headers.length} column(s) in the file didn't match the schema and were ignored: ${shown}${headers.length > 6 ? '…' : ''}`;
  })();

  return (
    <div className="panel">
      <h2>Bulk Upload</h2>

      <div className="template-row">
        <button type="button" className="btn-secondary template-btn" onClick={handleTemplate}>
          <Download size={14} /> Download Excel template
        </button>
        <span className="template-hint">
          A blank workbook with every column of the register. The
          {' '}<strong>Field Guide</strong> tab at the bottom of the sheet explains each
          column, with an example value and whether it is required.
        </span>
      </div>

      <div
        className={`drop-zone${dragOver ? ' dragover' : ''}`}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFile(e.dataTransfer.files?.[0]);
        }}
      >
        <UploadCloud size={26} className="drop-icon" />
        <div><strong>Click to browse</strong> or drag a file here</div>
        <div className="drop-hint">.xlsx, .xls, .csv &mdash; first sheet is used</div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        hidden
        onChange={(e) => handleFile(e.target.files?.[0])}
      />

      {status && <div className={`banner banner-${status.kind} upload-status`}>{status.text}</div>}

      {report?.accounts && (
        <div className="import-accounts">
          <div className="import-accounts-head">
            <strong>
              {report.accounts.created.length.toLocaleString('en-IN')} login account(s) created
            </strong>
            {report.accounts.created.length > 0 && (
              <>
                {' '}&mdash; everyone signs in with{' '}
                <code>{report.accounts.defaultPassword}</code> and is required to set
                their own password before they can use the app.
              </>
            )}
          </div>

          {report.accounts.created.length > 0 && (
            <details className="import-report-group">
              <summary>Usernames &mdash; what to tell people</summary>
              <ul className="import-accounts-list">
                {report.accounts.created.map((a) => (
                  <li key={a.username}>
                    <code>{a.username}</code>
                    <span className="import-report-reason">{a.name}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {report.accounts.skipped.length > 0 && (
            <details className="import-report-group">
              <summary>
                {report.accounts.skipped.length.toLocaleString('en-IN')} name(s) got no account
                {' '}&mdash; create any of these by hand in User Management if they are people
              </summary>
              <ul>
                {report.accounts.skipped.slice(0, REPORT_LIMIT).map((s) => (
                  <li key={s.name}>
                    <span className="import-report-row">{s.name}</span>
                    <span className="import-report-reason">{s.reason}</span>
                  </li>
                ))}
              </ul>
              {report.accounts.skipped.length > REPORT_LIMIT && (
                <div className="import-report-more">
                  &hellip;and {(report.accounts.skipped.length - REPORT_LIMIT).toLocaleString('en-IN')} more.
                </div>
              )}
            </details>
          )}
        </div>
      )}

      {report && (report.errors?.length > 0 || report.warnings?.length > 0) && (
        <div className="import-report">
          {report.errors?.length > 0 && (
            <div className="import-rejected">
              <div className="import-rejected-text">
                <strong>
                  {report.errors.length.toLocaleString('en-IN')} row(s) were not imported.
                </strong>
                {' '}Download them as a workbook, fix the cells the last column names,
                and upload that file &mdash; it is already in the right shape, so nothing
                has to be copied back by hand.
              </div>
              <button type="button" className="btn-primary import-rejected-btn"
                onClick={downloadRejected}>
                <Download size={14} /> Download the {report.errors.length.toLocaleString('en-IN')} rejected row(s)
              </button>
            </div>
          )}

          {report.errors?.length > 0 && (
            <details className="import-report-group" open>
              <summary>
                <strong>{report.errors.length.toLocaleString('en-IN')} row(s) not imported</strong>
                {' '}&mdash; the reasons, in full
              </summary>
              <ul>
                {report.errors.slice(0, REPORT_LIMIT).map((e) => (
                  <li key={`e${e.row}`}>
                    <span className="import-report-row">{describeRow(e.row)}</span>
                    <span className="import-report-reason">{e.reason}</span>
                  </li>
                ))}
              </ul>
              {report.errors.length > REPORT_LIMIT && (
                <div className="import-report-more">
                  &hellip;and {(report.errors.length - REPORT_LIMIT).toLocaleString('en-IN')} more.
                </div>
              )}
            </details>
          )}

          {report.warnings?.length > 0 && (
            <details className="import-report-group">
              <summary>
                <strong>{report.warnings.length.toLocaleString('en-IN')} row(s) imported with a field cleared</strong>
                {' '}&mdash; the record is in, one cell was not usable
              </summary>
              <ul>
                {report.warnings.slice(0, REPORT_LIMIT).map((w) => (
                  <li key={`w${w.row}`}>
                    <span className="import-report-row">{describeRow(w.row)}</span>
                    <span className="import-report-reason">{w.reason}</span>
                  </li>
                ))}
              </ul>
              {report.warnings.length > REPORT_LIMIT && (
                <div className="import-report-more">
                  &hellip;and {(report.warnings.length - REPORT_LIMIT).toLocaleString('en-IN')} more.
                </div>
              )}
            </details>
          )}
        </div>
      )}

      {parsed && (
        <div className="upload-preview">
          <div className="upload-summary">
            {`${fileName}: ${parsed.rows.length} record(s) ready to import`}
            {parsed.rows.length > PREVIEW_ROWS ? ` (showing first ${PREVIEW_ROWS} of ${parsed.rows.length})` : ''}
            .{unmatchedNote}
          </div>

          <table className="upload-preview-table">
            <thead>
              <tr>
                {previewColumns.map((k) => <th key={k}>{byKeyFor(k, register).label}</th>)}
              </tr>
            </thead>
            <tbody>
              {parsed.rows.slice(0, PREVIEW_ROWS).map((r, i) => (
                // eslint-disable-next-line react/no-array-index-key
                <tr key={i}>
                  {previewColumns.map((k) => <td key={k}>{formatIfDate(r[k]) || ''}</td>)}
                </tr>
              ))}
            </tbody>
          </table>

          <div className="upload-dedupe">
            <label htmlFor="uploadDedupeKey">Skip duplicates by</label>
            <select
              id="uploadDedupeKey"
              value={dedupeKey}
              onChange={(e) => setDedupeKey(e.target.value)}
            >
              {DEDUPE_CHOICES.map((c) => (
                <option key={c.value} value={c.value}>
                  {register === SOFTWARE && ['srl', 'poNo', 'assetTag'].includes(c.value)
                    ? `Match on ${byKeyFor(c.value, register).label} only`
                      + (c.value === 'assetTag' ? ' — not unique, can drop licences' : '')
                    : c.label}
                </option>
              ))}
            </select>
          </div>

          {isAssets && (
            <label className="upload-accounts">
              <input
                type="checkbox"
                checked={createUsers}
                onChange={(e) => setCreateUsers(e.target.checked)}
              />
              <span>
                <strong>Also create user records</strong> for the people named in Assigned
                User &mdash; as assignees (they cannot sign in), username <code>first.last</code>,
                with their Email ID, Location and <strong>Date of Joining</strong> taken from
                the same row. People already on file are kept as they are, except that one
                with no joining date gets it. Values that look like a place or a role are
                skipped and listed.
              </span>
            </label>
          )}

          <button type="button" className="btn-primary" onClick={doImport} disabled={importing}>
            {importing ? 'Importing…' : 'Import Records'}
          </button>
        </div>
      )}

      {noPo && (
        <PoReminderDialog
          bulk
          label={meta.labels?.poNo || 'PO No.'}
          missing={noPo}
          total={parsed?.rows?.length || 0}
          onContinue={afterPoReminder}
          onCancel={() => setNoPo(null)}
        />
      )}

      {unknown && (
        <UnknownMastersDialog
          unknown={unknown}
          rows={parsed?.rows || []}
          onInclude={() => runImport('include')}
          onReject={() => runImport('reject')}
          onCancel={() => setUnknown(null)}
        />
      )}
    </div>
  );
};

export default BulkUpload;
