import { useEffect, useMemo, useState } from 'react';
import { Tag, X } from 'lucide-react';
import api, { errorMessage } from '../api';
import { useAssets } from '../context/AssetsContext';
import PersonPicker from './PersonPicker';

const SellModal = ({ record, onClose, onDone }) => {
  const { updateAsset, formOptionsFor } = useAssets();
  const [buyer, setBuyer] = useState('');
  const [buyerEmail, setBuyerEmail] = useState('');
  const [note, setNote] = useState('');
  const [people, setPeople] = useState(null);
  const [mode, setMode] = useState('off');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    api.get('/users')
      .then((res) => { if (live) setPeople((res.data || []).filter((p) => p.isActive)); })
      .catch(() => { if (live) setPeople([]); });
    api.get('/notifications/mode')
      .then((res) => { if (live) setMode(res.data?.mode || 'off'); })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  const soldStatus = useMemo(
    () => formOptionsFor('status').find((s) => /sold/i.test(s)) || 'SOLD',
    [formOptionsFor],
  );
  const approve = mode === 'approve';
  const chosen = (people || []).find(
    (p) => (p.fullName || '').trim().toLowerCase() === buyer.trim().toLowerCase(),
  ) || null;

  const submit = async () => {
    const name = buyer.trim();
    if (!name) {
      setError('Type who it is being sold to.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const saved = await updateAsset(record.id, {
        status: soldStatus,
        user: name,
        email: buyerEmail,
        ...(approve ? { approvalReason: note.trim() } : {}),
      });
      if (saved?.approvalRequested) {
        onDone(`Sent to the IT head for approval: sell ${record.assetId} to ${name}. Nothing has `
          + 'changed yet, and the record is locked until they decide.', 'info');
        return;
      }
      onDone(`${record.assetId} marked ${soldStatus}, sold to ${saved?.user || name}.`
        + (mode === 'inform' ? ' The IT head has been emailed.' : ''), 'success');
    } catch (err) {
      setError(errorMessage(err, 'Could not mark it sold.'));
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}>
      <div className="modal modal-narrow" role="dialog" aria-labelledby="sellTitle">
        <div className="modal-head">
          <h2 id="sellTitle">Sell {record.assetId}</h2>
          <button type="button" className="modal-close" onClick={onClose} title="Close" disabled={saving}>
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          {error && <div className="banner banner-error">{error}</div>}
          <div className="transfer-from">
            <span className="transfer-from-label">Selling</span>
            <span className="transfer-from-value">
              {[record.assetTag, record.model, record.srl && `Srl ${record.srl}`].filter(Boolean).join(' · ')}
              {record.user ? ` — now with ${record.user}` : ''}
            </span>
          </div>

          <div className="field">
            <label htmlFor="sellBuyer">Sold to *</label>
            <PersonPicker
              id="sellBuyer"
              offered={people || []}
              selected={chosen}
              text={buyer}
              onTextChange={(v) => { setBuyer(v); setBuyerEmail(''); setError(''); }}
              onPick={(p) => {
                if (!p) return;
                setBuyer(p.fullName || p.username);
                setBuyerEmail(p.email || '');
              }}
              loading={people === null}
              placeholder="The buyer’s name — anyone, or pick someone on file"
            />
            <p className="field-hint">
              Saved as the Assigned User, with the status {soldStatus}.
            </p>
          </div>

          {approve && (
            <div className="field">
              <label htmlFor="sellNote">Note for the IT head</label>
              <textarea id="sellNote" className="field-input" rows={3} maxLength={500}
                value={note} onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Sold to the employee at book value" />
              <p className="field-hint">
                Selling needs the IT head’s approval. Nothing changes until they approve from the
                email, and the record is locked meanwhile.
              </p>
            </div>
          )}
          {mode === 'inform' && (
            <p className="field-hint">The IT head will be emailed about the sale.</p>
          )}
        </div>

        <div className="modal-foot">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className="btn-primary" onClick={submit} disabled={saving || !buyer.trim()}>
            <Tag size={14} />{' '}
            {saving ? 'Saving…' : approve ? 'Send for approval' : 'Mark as sold'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SellModal;
