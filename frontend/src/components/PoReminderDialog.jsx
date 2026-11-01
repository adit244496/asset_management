import { useEffect } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import './UnknownMastersDialog.css';

const MAX_SHOWN = 12;

const PoReminderDialog = ({
  label = 'PO No.', missing = [], total = 1, bulk = false, onContinue, onCancel,
}) => {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const count = bulk ? missing.length : 1;
  return (
    <div className="modal-overlay" onMouseDown={onCancel}>
      <div className="modal unknown-modal" role="alertdialog" aria-labelledby="po-reminder-title"
        onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2 id="po-reminder-title"><AlertTriangle size={16} /> {label} missing</h2>
          <button type="button" className="modal-close" onClick={onCancel} title="Go back">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          {bulk ? (
            <>
              <p className="unknown-lead">
                <strong>{count.toLocaleString('en-IN')} of {total.toLocaleString('en-IN')}</strong> row(s)
                in this file have no <strong>{label}</strong> filled in. Did you forget it?
              </p>
              <ul className="unknown-values">
                {missing.slice(0, MAX_SHOWN).map((m, i) => <li key={`${i}-${m}`}>{m}</li>)}
              </ul>
              {missing.length > MAX_SHOWN && (
                <div className="unknown-more">and {missing.length - MAX_SHOWN} more</div>
              )}
              <p className="unknown-note">
                Add the {label} to those rows and upload the file again, or import them as they
                are and add it later with Edit.
              </p>
            </>
          ) : (
            <>
              <p className="unknown-lead">
                The <strong>{label}</strong> is empty. Did you forget to fill it in?
              </p>
              <p className="unknown-note">
                Go back and add it, or save without it and add it later with Edit.
              </p>
            </>
          )}
        </div>

        <div className="modal-foot">
          <button type="button" className="btn-secondary" onClick={onContinue}>
            {bulk ? `Import anyway` : 'Save without it'}
          </button>
          <button type="button" className="btn-primary" onClick={onCancel} autoFocus>
            {bulk ? 'Go back' : `Add the ${label}`}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PoReminderDialog;
