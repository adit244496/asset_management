import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import api, { errorMessage } from '../api';
import { describeUnknown, rowsAffected } from '../lib/unknownMasters';
import './UnknownMastersDialog.css';

const MAX_SHOWN = 12;
const TYPE_KEY = 'type';
const CODE_LEN = 3;
const CODE_RE = new RegExp(`^[A-Z][A-Z0-9]{${CODE_LEN - 1}}$`);

const cleanCode = (value) => (value ?? '').toString().replace(/[^A-Za-z0-9]/g, '').toUpperCase();

// Why this abbreviation cannot be used, or '' -- the same rules as the server.
function codeProblem(code, taken, others) {
  if (!code) return 'Required';
  if (!CODE_RE.test(code)) return `Exactly ${CODE_LEN} letters or digits, starting with a letter`;
  if (taken.has(code)) return `${code} is already used by another type`;
  if (others.includes(code)) return `${code} is given to two new types`;
  return '';
}

/* The values a bulk import would add to Master Data. New types (assets and
   peripherals) also show the abbreviation their IDs will start with
   (LAP -> LAP_00001), which can be changed here before importing -- once a
   type is added its abbreviation is fixed. */
const UnknownMastersDialog = ({ unknown, rows, codesFor = false, onInclude, onReject, onCancel }) => {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const affected = rowsAffected(rows, unknown);
  const total = unknown.reduce((n, u) => n + u.values.length, 0);
  const newTypes = useMemo(
    () => (codesFor ? unknown.find((u) => u.key === TYPE_KEY)?.values || [] : []),
    [codesFor, unknown],
  );

  // {name, code} for each new type, as suggested and then as edited.
  const [codes, setCodes] = useState(null);
  const [taken, setTaken] = useState(() => new Set());
  const [planError, setPlanError] = useState('');

  useEffect(() => {
    if (!newTypes.length) return undefined;
    let live = true;
    api.post('/masters/type/new-codes', { names: newTypes })
      .then((res) => {
        if (!live) return;
        setTaken(new Set((res.data.taken || []).map((c) => c.toUpperCase())));
        setCodes((res.data.items || []).map((i) => ({ name: i.name, code: i.code, suggested: i.code })));
      })
      .catch((err) => {
        if (!live) return;
        setPlanError(errorMessage(err, 'Could not work out the abbreviations.'));
        setCodes([]);
      });
    return () => { live = false; };
  }, [newTypes]);

  const problems = (codes || []).map((c, i) => codeProblem(
    c.code, taken, codes.filter((_, j) => j !== i).map((o) => o.code),
  ));
  const loading = newTypes.length > 0 && codes === null;
  const blocked = loading || problems.some(Boolean);

  const setCode = (index, value) => {
    setCodes((list) => list.map((c, i) => (i === index ? { ...c, code: cleanCode(value).slice(0, CODE_LEN) } : c)));
  };

  const include = () => {
    if (blocked) return;
    onInclude(Object.fromEntries((codes || []).map((c) => [c.name, c.code])));
  };

  const valueList = (group) => (
    <>
      <ul className="unknown-values">
        {group.values.slice(0, MAX_SHOWN).map((value) => (
          <li key={value}>{value}</li>
        ))}
      </ul>
      {group.values.length > MAX_SHOWN && (
        <div className="unknown-more">
          and {group.values.length - MAX_SHOWN} more
        </div>
      )}
    </>
  );

  const codeTable = () => {
    if (loading) return <div className="unknown-more">Working out the abbreviations&hellip;</div>;
    if (planError || !codes.length) {
      return (
        <>
          {valueList(unknown.find((u) => u.key === TYPE_KEY))}
          {planError && (
            <div className="unknown-code-error">
              {planError} Each type is given its abbreviation automatically as it is added.
            </div>
          )}
        </>
      );
    }
    return (
      <>
        <p className="unknown-code-lead">
          Each new type gets an abbreviation that starts its IDs. Change any you like
          &mdash; once the type is added it cannot be changed.
        </p>
        <table className="unknown-codes">
          <thead>
            <tr><th>Type</th><th>Abbreviation</th><th>New IDs</th></tr>
          </thead>
          <tbody>
            {codes.map((c, i) => (
              <tr key={c.name}>
                <td className="unknown-code-name">{c.name}</td>
                <td>
                  <input
                    className={`unknown-code-input${problems[i] ? ' invalid' : ''}`}
                    value={c.code}
                    maxLength={CODE_LEN}
                    aria-label={`Abbreviation for ${c.name}`}
                    aria-invalid={Boolean(problems[i])}
                    spellCheck={false}
                    onChange={(e) => setCode(i, e.target.value)}
                  />
                  {c.code !== c.suggested && (
                    <button type="button" className="unknown-code-reset"
                      onClick={() => setCode(i, c.suggested)} title={`Back to ${c.suggested}`}>
                      Reset
                    </button>
                  )}
                  {problems[i] && <div className="unknown-code-error">{problems[i]}</div>}
                </td>
                <td className="unknown-code-id">{CODE_RE.test(c.code) ? `${c.code}_00001…` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </>
    );
  };

  return (
    <div className="modal-overlay" onMouseDown={onCancel}>
      <div className="modal unknown-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2><AlertTriangle size={16} /> Values not in the master data</h2>
          <button type="button" className="modal-close" onClick={onCancel} title="Cancel">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <p className="unknown-lead">
            This file uses <strong>{describeUnknown(unknown)}</strong> that no master
            list has. {affected.toLocaleString('en-IN')} of {rows.length.toLocaleString('en-IN')}
            {' '}row(s) carry them.
          </p>

          {unknown.map((group) => (
            <div className="unknown-group" key={group.key}>
              <div className="unknown-group-head">
                {group.label}
                <span className="unknown-count">{group.values.length}</span>
              </div>
              {newTypes.length && group.key === TYPE_KEY ? codeTable() : valueList(group)}
            </div>
          ))}

          <p className="unknown-note">
            Adding them puts {total === 1 ? 'it' : 'them'} in the dropdowns for everyone.
            Skipping leaves the master data alone and imports the rest of the file &mdash;
            add the real ones in <strong>Master Data</strong> and upload again.
          </p>
        </div>

        <div className="modal-foot">
          <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn-secondary" onClick={onReject}>
            Skip those {affected.toLocaleString('en-IN')} row(s)
          </button>
          <button type="button" className="btn-primary" onClick={include} disabled={blocked}
            title={blocked && !loading ? 'Fix the abbreviations marked in red first' : undefined}>
            Add {total.toLocaleString('en-IN')} value(s) and import
          </button>
        </div>
      </div>
    </div>
  );
};

export default UnknownMastersDialog;
