import { useEffect, useMemo, useRef, useState } from 'react';
import { UploadCloud, X } from 'lucide-react';
import api, { errorMessage } from '../api';
import { USERS_SHEET, readMasterWorkbook } from '../lib/masterWorkbook';
import { rowProblems } from '../lib/userImport';
import './MasterBulkAdd.css';

const MasterWorkbookUpload = ({ categories, onClose, onDone }) => {
  const fileInputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState(null);
  const [existing, setExisting] = useState(null);
  const [userEmails, setUserEmails] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    api.get('/masters/export')
      .then((res) => {
        const items = res.data?.items || {};
        setExisting(Object.fromEntries(Object.entries(items).map(
          ([k, rows]) => [k, new Set(rows.map((r) => String(r.name).trim().toLowerCase()))],
        )));
        setUserEmails(new Set((res.data?.users || [])
          .map((u) => String(u.email || '').trim().toLowerCase()).filter(Boolean)));
      })
      .catch(() => { setExisting({}); setUserEmails(new Set()); });
  }, []);

  const handleFile = async (file) => {
    if (!file) return;
    setError('');
    setResult(null);
    if (!/\.(xlsx|xls)$/i.test(file.name)) {
      setError('Choose the Master Data workbook (.xlsx).');
      return;
    }
    try {
      const out = await readMasterWorkbook(file, categories);
      if (!out.sheets.length && !out.users?.rows.length) {
        setParsed(null);
        setError(`No sheet in “${file.name}” is named after a Master Data list `
          + `(${[...categories.map((c) => c.plural), USERS_SHEET].join(', ')}).`);
        return;
      }
      setFileName(file.name);
      setParsed(out);
    } catch (err) {
      setParsed(null);
      setError(`Could not read “${file.name}”: ${err?.message || err}`);
    }
  };

  const preview = useMemo(() => (parsed?.sheets || []).map((s) => {
    const have = existing?.[s.key] || new Set();
    const names = parsed.lists[s.key].map((e) => e.name.toLowerCase()).filter(Boolean);
    const known = names.filter((n) => have.has(n)).length;
    return { ...s, known, fresh: new Set(names.filter((n) => !have.has(n))).size };
  }), [parsed, existing]);

  const userPreview = useMemo(() => {
    const rows = parsed?.users?.rows || [];
    const signIn = parsed?.users?.signInLeftOut || 0;
    if (!rows.length && !signIn) return null;
    const bad = rows.filter((r) => rowProblems(r).length).length;
    const good = rows.filter((r) => !rowProblems(r).length);
    const known = good.filter((r) => userEmails?.has(String(r.email).trim().toLowerCase())).length;
    return { count: rows.length + signIn, known, fresh: good.length - known, bad, signIn };
  }, [parsed, userEmails]);

  const notInFile = parsed ? [
    ...categories.filter((c) => !parsed.lists[c.key]).map((c) => c.plural),
    ...(userPreview ? [] : [USERS_SHEET]),
  ] : [];

  const upload = async () => {
    setUploading(true);
    setError('');
    const out = { lists: {}, errors: [], users: null };
    try {
      if (parsed.sheets.length) {
        const res = await api.post('/masters/import', { lists: parsed.lists });
        out.lists = res.data?.lists || {};
        out.errors = res.data?.errors || [];
      }
      if (parsed.users?.rows.length) {
        try {
          out.users = (await api.post('/users/bulk', { rows: parsed.users.rows })).data;
          (out.users.skipped || []).forEach((s) => out.errors.push({
            list: USERS_SHEET, row: s.row, reason: `${s.name ? `${s.name}: ` : ''}${s.reason}`, users: true,
          }));
        } catch (err) {
          setError(errorMessage(err, 'Could not upload the Users sheet.')
            + (parsed.sheets.length ? ' The lists were uploaded.' : ''));
          if (!parsed.sheets.length) return;
        }
      }
      setResult(out);
    } catch (err) {
      setError(errorMessage(err, 'Could not upload the workbook.'));
    } finally {
      setUploading(false);
    }
  };

  const plural = (key) => categories.find((c) => c.key === key)?.plural || key;
  const totals = result && Object.values(result.lists || {}).reduce(
    (t, c) => ({ added: t.added + c.added, updated: t.updated + c.updated }), { added: 0, updated: 0 },
  );
  const userCounts = result?.users && {
    added: result.users.created?.length || 0,
    updated: result.users.updated?.length || 0,
    unchanged: result.users.unchanged || 0,
    skipped: result.users.skipped?.length || 0,
  };
  const finish = () => onDone(
    `Workbook uploaded: ${totals.added} value(s) added, ${totals.updated} updated`
    + (userCounts ? `; ${userCounts.added} user(s) added, ${userCounts.updated} updated` : '')
    + (result.errors?.length ? `; ${result.errors.length} row(s) skipped.` : '.'),
  );
  const rowOf = (err) => {
    if (err.users) return parsed?.users?.rowNumbers?.[err.row] ?? err.row + 2;
    const key = categories.find((c) => c.plural === err.list)?.key;
    return parsed?.rowNumbers?.[key]?.[err.row] ?? err.row + 2;
  };

  return (
    <div
      className="modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget && !uploading) (result ? finish() : onClose()); }}
    >
      <div className="modal">
        <div className="modal-head">
          <h2>Upload Master Data workbook</h2>
          <button type="button" className="modal-close" onClick={result ? finish : onClose} title="Close">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          {error && <div className="banner banner-error">{error}</div>}

          {!result && (
            <>
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
                <UploadCloud size={24} className="drop-icon" />
                <div><strong>Click to browse</strong> or drag the workbook here</div>
                <div className="drop-hint">
                  The .xlsx from Download all or the data export email &mdash; one sheet per list, and Users
                </div>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                hidden
                onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = ''; }}
              />
            </>
          )}

          {parsed && !result && (
            <div className="bulk-add-preview">
              <div className="bulk-file-name">{fileName}</div>
              <table className="bulk-add-table">
                <thead>
                  <tr><th>List</th><th>Values in the sheet</th><th>New</th><th>Already in the list (updated)</th></tr>
                </thead>
                <tbody>
                  {preview.map((s) => (
                    <tr key={s.key}>
                      <td>{s.plural}</td>
                      <td>{s.count.toLocaleString('en-IN')}</td>
                      <td>{existing ? s.fresh.toLocaleString('en-IN') : '…'}</td>
                      <td>{existing ? s.known.toLocaleString('en-IN') : '…'}</td>
                    </tr>
                  ))}
                  {userPreview && (
                    <tr>
                      <td>{USERS_SHEET}</td>
                      <td>{userPreview.count.toLocaleString('en-IN')}</td>
                      <td>{userEmails ? userPreview.fresh.toLocaleString('en-IN') : '…'}</td>
                      <td>{userEmails ? userPreview.known.toLocaleString('en-IN') : '…'}</td>
                    </tr>
                  )}
                </tbody>
              </table>
              <div className="field-hint">
                {notInFile.length > 0 && (
                  <>Not in this file, so left as they are: {notInFile.join(', ')}. </>
                )}
                {parsed.ignored.length > 0 && <>Sheets left out: {parsed.ignored.join(', ')}. </>}
                Values in a list but not in the file are kept.
                {userPreview && (
                  <>
                    {' '}Users are matched by Email ID: new people are added as assignees on the
                    starting password, people already on file have Email ID, Location and Date of
                    Joining updated. Profiles and passwords are never changed.
                    {userPreview.signIn > 0 && (
                      <> {userPreview.signIn} sign-in account(s) without an Email ID or Date of
                        Joining are left out &mdash; they are set up one at a time.</>
                    )}
                    {userPreview.bad > 0 && (
                      <> {userPreview.bad} user row(s) lack Full Name, Email ID, Location or Date of
                        Joining and will be skipped.</>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {result && (
            <div className="bulk-add-preview">
              <table className="bulk-add-table">
                <thead>
                  <tr><th>List</th><th>Added</th><th>Updated</th><th>Unchanged</th><th>Skipped</th></tr>
                </thead>
                <tbody>
                  {categories.filter((cat) => result.lists?.[cat.key]).map(({ key }) => [key, result.lists[key]])
                    .map(([key, c]) => (
                    <tr key={key}>
                      <td>{plural(key)}</td>
                      <td>{c.added}</td>
                      <td>{c.updated}</td>
                      <td>{c.unchanged}</td>
                      <td>{c.skipped}</td>
                    </tr>
                  ))}
                  {userCounts && (
                    <tr>
                      <td>{USERS_SHEET}</td>
                      <td>{userCounts.added}</td>
                      <td>{userCounts.updated}</td>
                      <td>{userCounts.unchanged}</td>
                      <td>{userCounts.skipped}</td>
                    </tr>
                  )}
                </tbody>
              </table>
              {result.errors?.length > 0 && (
                <>
                  <div className="field-hint">Rows not taken:</div>
                  <table className="bulk-add-table">
                    <thead><tr><th>Sheet</th><th>Row</th><th>Why</th></tr></thead>
                    <tbody>
                      {result.errors.slice(0, 50).map((err, i) => (
                        <tr key={i} className="row-skipped">
                          <td>{err.list}</td>
                          <td>{rowOf(err)}</td>
                          <td>{err.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {result.errors.length > 50 && (
                    <div className="field-hint">…and {result.errors.length - 50} more.</div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        <div className="modal-foot">
          {result ? (
            <button type="button" className="btn-primary" onClick={finish}>Done</button>
          ) : (
            <>
              <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
              <button
                type="button"
                className="btn-primary"
                onClick={upload}
                disabled={!parsed || uploading}
              >
                {uploading ? 'Uploading…' : 'Upload'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default MasterWorkbookUpload;
