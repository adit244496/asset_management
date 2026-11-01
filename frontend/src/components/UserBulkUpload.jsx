import { useRef, useState } from 'react';
import { Download, FileUp, X } from 'lucide-react';
import api, { errorMessage } from '../api';
import {
  USER_COLUMNS, downloadTemplate, parseUserFile, rowProblems,
} from '../lib/userImport';
import './UserBulkUpload.css';

const PREVIEW_ROWS = 100;

const COLUMN_NOTES = {
  fullName: 'How the name appears on assets. The username is made from it.',
  email: 'Identifies the person: someone already on file with this address is updated.',
  location: 'As spelled in Master Data > Locations.',
  dateOfJoining: 'dd-mm-yyyy (Excel dates and yyyy-mm-dd are understood too).',
};

const UserBulkUpload = ({ onClose, onDone }) => {
  const fileRef = useRef(null);
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const choose = async (file) => {
    if (!file) return;
    setError('');
    setResult(null);
    setFileName(file.name);
    setBusy(true);
    try {
      const read = await parseUserFile(file);
      if (!read.rows.length) {
        setParsed(null);
        setError('No rows were found in that file. Fill in the template under its header row.');
        return;
      }
      setParsed(read);
    } catch (err) {
      setParsed(null);
      setError(errorMessage(err, 'That file could not be read. Use the CSV template, or an Excel file.'));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const problems = (parsed?.rows || []).map(rowProblems);
  const withProblems = problems.filter((p) => p.length).length;

  const upload = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await api.post('/users/bulk', { rows: parsed.rows });
      setResult(res.data);
      onDone?.(res.data);
    } catch (err) {
      setError(errorMessage(err, 'The upload failed. Nothing was changed.'));
    } finally {
      setBusy(false);
    }
  };

  const rowLabel = (index) => `Row ${index + 2}`;

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="modal user-bulk" role="dialog" aria-labelledby="userBulkTitle">
        <div className="modal-head">
          <h2 id="userBulkTitle">Bulk upload users</h2>
          <button type="button" className="modal-close" onClick={onClose} title="Close" disabled={busy}>
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          {error && <div className="banner banner-error">{error}</div>}

          {!result && (
            <>
              <div className="user-bulk-step">
                <span className="user-bulk-num">1</span>
                <div>
                  <p className="user-bulk-lede">
                    Download the template, fill in one row per person — every column is required —
                    and save it as CSV (or keep it as an Excel file). Everyone uploaded is an assignee
                    and cannot sign in; give app access one person at a time with New User. Upload the
                    whole list whenever it changes — people already on file are updated, not
                    duplicated.
                  </p>
                  <button type="button" className="btn-secondary" onClick={downloadTemplate}>
                    <Download size={14} /> Download CSV template
                  </button>
                  <table className="user-bulk-cols">
                    <tbody>
                      {USER_COLUMNS.map((c) => (
                        <tr key={c.key}>
                          <th>{c.header} *</th>
                          <td>{COLUMN_NOTES[c.key]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="user-bulk-step">
                <span className="user-bulk-num">2</span>
                <div>
                  <p className="user-bulk-lede">Choose the filled-in file.</p>
                  <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" hidden
                    onChange={(e) => choose(e.target.files?.[0])} />
                  <button type="button" className="btn-secondary" disabled={busy}
                    onClick={() => fileRef.current?.click()}>
                    <FileUp size={14} /> {fileName ? 'Choose another file' : 'Choose file'}
                  </button>
                  {fileName && <span className="user-bulk-file">{fileName}</span>}
                </div>
              </div>

              {parsed && (
                <div className="user-bulk-preview">
                  <p className="user-bulk-count">
                    <strong>{parsed.rows.length.toLocaleString('en-IN')}</strong> row(s) read
                    {withProblems > 0 && (
                      <span className="user-bulk-warn">
                        {' '}· {withProblems} with a problem — {withProblems === 1 ? 'it' : 'they'} will be
                        skipped unless corrected in the file
                      </span>
                    )}
                  </p>
                  {parsed.unmatchedHeaders.length > 0 && (
                    <p className="user-bulk-warn">
                      Columns not used: {parsed.unmatchedHeaders.join(', ')}.
                    </p>
                  )}
                  <div className="data-table-wrap user-bulk-table">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Row</th>
                          {USER_COLUMNS.map((c) => <th key={c.key}>{c.header}</th>)}
                          <th>Check</th>
                        </tr>
                      </thead>
                      <tbody>
                        {parsed.rows.slice(0, PREVIEW_ROWS).map((r, i) => (
                          // eslint-disable-next-line react/no-array-index-key -- rows have no id
                          <tr key={i} className={problems[i].length ? 'user-bulk-bad' : ''}>
                            <td>{i + 2}</td>
                            {USER_COLUMNS.map((c) => <td key={c.key}>{r[c.key] || '—'}</td>)}
                            <td>{problems[i].length ? problems[i].join('; ') : 'OK'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {parsed.rows.length > PREVIEW_ROWS && (
                    <p className="user-bulk-note">
                      Showing the first {PREVIEW_ROWS}; all {parsed.rows.length.toLocaleString('en-IN')} will be uploaded.
                    </p>
                  )}
                </div>
              )}
            </>
          )}

          {result && (
            <div className="user-bulk-result">
              <p className="user-bulk-count">
                <strong>{result.created.length}</strong> created ·{' '}
                <strong>{result.updated.length}</strong> updated ·{' '}
                <strong>{result.unchanged}</strong> already up to date ·{' '}
                <strong>{result.skipped.length}</strong> skipped
              </p>
              {result.skipped.length > 0 && (
                <>
                  <h4>Skipped</h4>
                  <ul className="user-bulk-list">
                    {result.skipped.map((s) => (
                      <li key={`s${s.row}`}><strong>{rowLabel(s.row)}</strong> {s.name ? `(${s.name})` : ''} — {s.reason}</li>
                    ))}
                  </ul>
                </>
              )}
              {result.updated.length > 0 && (
                <>
                  <h4>Updated</h4>
                  <ul className="user-bulk-list">
                    {result.updated.map((u) => (
                      <li key={`u${u.row}`}>
                        <strong>{u.username}</strong> — {u.fields.join(', ')}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {result.created.length > 0 && (
                <>
                  <h4>Created</h4>
                  <ul className="user-bulk-list">
                    {result.created.map((c) => (
                      <li key={`c${c.row}`}>
                        <strong>{c.username}</strong> — {c.fullName}{c.note ? ` (${c.note})` : ''}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </div>

        <div className="modal-foot">
          {result ? (
            <button type="button" className="btn-primary" onClick={onClose}>Done</button>
          ) : (
            <>
              <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
              <button type="button" className="btn-primary" onClick={upload}
                disabled={busy || !parsed || !parsed.rows.length}>
                {busy && parsed ? 'Uploading…'
                  : `Upload ${parsed ? parsed.rows.length.toLocaleString('en-IN') : ''} user(s)`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default UserBulkUpload;
