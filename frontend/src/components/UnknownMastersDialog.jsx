import { useEffect } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { describeUnknown, rowsAffected } from '../lib/unknownMasters';
import './UnknownMastersDialog.css';

const MAX_SHOWN = 12;

const UnknownMastersDialog = ({ unknown, rows, onInclude, onReject, onCancel }) => {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const affected = rowsAffected(rows, unknown);
  const total = unknown.reduce((n, u) => n + u.values.length, 0);

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
          <button type="button" className="btn-primary" onClick={onInclude}>
            Add {total.toLocaleString('en-IN')} value(s) and import
          </button>
        </div>
      </div>
    </div>
  );
};

export default UnknownMastersDialog;
