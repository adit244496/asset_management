import { useEffect, useState } from 'react';
import { ArrowDownToLine, UserPlus, X } from 'lucide-react';
import api, { errorMessage } from '../api';
import { useAssets } from '../context/AssetsContext';
import PersonPicker from './PersonPicker';
import './TransferModal.css';

const RUPEES = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });

const SoftwareMoveModal = ({ record, action, onClose, onDone }) => {
  const { moveSoftware } = useAssets();
  const assign = action === 'assign';
  const total = Number.parseInt(record.quantity, 10) || 1;
  const [quantity, setQuantity] = useState(String(total));
  const [people, setPeople] = useState(assign ? null : []);
  const [person, setPerson] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!assign) return undefined;
    let live = true;
    api.get('/users')
      .then((res) => { if (live) setPeople((res.data || []).filter((p) => p.isActive)); })
      .catch((err) => { if (live) { setPeople([]); setError(errorMessage(err, 'Could not load the list of people.')); } });
    return () => { live = false; };
  }, [assign]);

  const n = /^\d+$/.test(quantity.trim()) ? Number(quantity.trim()) : NaN;
  const valid = Number.isInteger(n) && n >= 1 && n <= total;
  const partial = valid && n < total;
  const price = Number(record.price);
  const share = valid && Number.isFinite(price) && String(record.price).trim() !== ''
    ? Math.round((price * n * 100) / total) / 100 : null;
  const ready = valid && (!assign || person);

  const submit = async () => {
    if (!ready) return;
    setSaving(true);
    setError('');
    try {
      const res = await moveSoftware(record.id, {
        action, quantity: n, ...(assign ? { userId: person.id } : {}),
      });
      const who = assign ? (person.fullName || person.username) : 'stock';
      const where = !res.split
        ? `${record.assetId} is now ${assign ? `with ${who}` : 'in stock'}`
        : `${res.record.assetId} ${res.merged ? 'now holds them' : 'was created for them'}; `
          + `${record.assetId} keeps ${res.source.quantity}`;
      onDone(`${assign ? 'Assigned' : 'Moved'} ${n} of ${record.assetTag} to ${who}. ${where}.`);
    } catch (err) {
      setError(errorMessage(err, 'Could not move it.'));
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}>
      <div className="modal modal-narrow" role="dialog" aria-labelledby="swMoveTitle">
        <div className="modal-head">
          <h2 id="swMoveTitle">{assign ? 'Assign from stock' : 'Move to stock'} — {record.assetId}</h2>
          <button type="button" className="modal-close" onClick={onClose} title="Close" disabled={saving}>
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          {error && <div className="banner banner-error">{error}</div>}
          <div className="transfer-from">
            <span className="transfer-from-label">{assign ? 'In stock' : 'Now with'}</span>
            <span className="transfer-from-value">
              {[record.assetTag, record.version].filter(Boolean).join(' ')}
              {' · '}{total} {total === 1 ? 'seat' : 'seats'}
              {!assign && record.vendor ? ` — ${record.vendor}` : ''}
            </span>
          </div>

          <div className="field">
            <label htmlFor="swMoveQty">How many *</label>
            <div className="sw-move-qty">
              <input
                id="swMoveQty"
                className={`field-input${quantity && !valid ? ' has-error' : ''}`}
                type="number"
                min={1}
                max={total}
                step={1}
                value={quantity}
                onChange={(e) => { setQuantity(e.target.value); setError(''); }}
              />
              <span className="sw-move-of">of {total}</span>
              {n !== total && (
                <button type="button" className="btn-ghost" onClick={() => setQuantity(String(total))}>
                  All {total}
                </button>
              )}
            </div>
            <div className="field-error">{quantity && !valid ? `A whole number from 1 to ${total}` : ''}</div>
          </div>

          {assign && (
            <div className="field">
              <label htmlFor="swMovePerson">Assign to *</label>
              <PersonPicker
                id="swMovePerson"
                offered={people || []}
                selected={person}
                onPick={(p) => { setPerson(p); setError(''); }}
                loading={people === null}
                placeholder="Type a name from the user directory…"
              />
              <p className="field-hint">Saved as Vendor / Used By.</p>
            </div>
          )}

          {valid && (
            <p className="field-hint sw-move-plan">
              {partial
                ? <>The record is split: <strong>{record.assetId}</strong> keeps {total - n} in its
                  current place, and {n} {assign ? `go to ${person ? (person.fullName || person.username) : 'the person'}` : 'go to stock'}
                  {' '}— added to {assign ? 'their' : 'the'} existing {record.assetTag} record if there is one, otherwise as a new record.</>
                : <>The whole record moves{assign ? '' : ' into stock, and Vendor / Used By is cleared'}.</>}
              {share !== null && partial && <> The {n} moved are valued at ₹ {RUPEES.format(share)}.</>}
            </p>
          )}
        </div>

        <div className="modal-foot">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className="btn-primary" onClick={submit} disabled={saving || !ready}>
            {assign ? <UserPlus size={14} /> : <ArrowDownToLine size={14} />}{' '}
            {saving ? 'Moving…' : assign ? `Assign ${valid ? n : ''}` : `Move ${valid ? n : ''} to stock`}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SoftwareMoveModal;
