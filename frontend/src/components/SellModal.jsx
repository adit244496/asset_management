import { useEffect, useMemo, useState } from 'react';
import { Tag, X } from 'lucide-react';
import api, { errorMessage } from '../api';
import { useAssets } from '../context/AssetsContext';
import PersonPicker from './PersonPicker';
import './UserModal.css';

const listed = (ids) => ids.slice(0, 5).join(', ') + (ids.length > 5 ? ` and ${ids.length - 5} more` : '');

const SellModal = ({ record, onClose, onDone }) => {
  const { updateAsset, formOptionsFor, assets } = useAssets();
  // Its linked peripherals are not sold with it: they go to stock, or are scrapped.
  const linked = record.linkedPeripherals || [];
  const [linkedTo, setLinkedTo] = useState('stock');
  const [scrapShared, setScrapShared] = useState(false);
  const sharedOthers = useMemo(() => linked.map((p) => {
    const others = (assets || []).filter((a) => a && !a.isDeleted && a.id !== record.id
      && (a.linkedPeripherals || []).some((x) => x.id === p.id)).map((a) => a.assetId);
    return others.length ? `${p.label || p.assetId} (also on ${others.join(', ')})` : null;
  }).filter(Boolean), [linked, assets, record.id]);
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
      .catch(() => { });
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
      const scrapLinked = linked.length > 0 && linkedTo === 'scrap';
      const saved = await updateAsset(record.id, {
        status: soldStatus,
        user: name,
        email: buyerEmail,
        ...(scrapLinked ? { scrapLinked: true, ...(scrapShared ? { scrapShared: true } : {}) } : {}),
        ...(approve ? { approvalReason: note.trim() } : {}),
      });
      if (saved?.approvalRequested) {
        onDone(`Sent to the IT head for approval: sell ${record.assetId} to ${name}. Nothing has `
          + 'changed yet, and the record is locked until they decide.', 'info');
        return;
      }
      const rel = saved?.linkedReleased || {};
      const toStock = rel.toStock || [];
      const scrapped = rel.scrapped || [];
      const offOthers = rel.offOthers || [];
      onDone(`${record.assetId} marked ${soldStatus}, sold to ${saved?.user || name}.`
        + (scrapped.length ? ` Linked peripheral${scrapped.length === 1 ? '' : 's'} ${listed(scrapped)} scrapped`
          + (offOthers.length ? ` and taken off ${listed(offOthers)}` : '') + '.' : '')
        + (toStock.length ? ` Linked peripheral${toStock.length === 1 ? '' : 's'} ${listed(toStock)} sent to stock.` : '')
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

          {linked.length > 0 && (
            <div className="field sell-linked">
              <label>Linked peripherals: {linked.map((p) => p.label || p.assetId).join(', ')}</label>
              <p className="field-hint">Peripherals are not sold with the asset. What should happen to them?</p>
              <label className="user-must-change">
                <input type="radio" name="sellLinked" value="stock" checked={linkedTo === 'stock'}
                  onChange={() => setLinkedTo('stock')} />
                <span>Send them to stock</span>
              </label>
              <label className="user-must-change">
                <input type="radio" name="sellLinked" value="scrap" checked={linkedTo === 'scrap'}
                  onChange={() => setLinkedTo('scrap')} />
                <span>Scrap them</span>
              </label>
              {linkedTo === 'scrap' && sharedOthers.length > 0 && (
                <label className="user-must-change sell-shared-tick">
                  <input type="checkbox" checked={scrapShared} onChange={(e) => setScrapShared(e.target.checked)} />
                  <span>
                    Also scrap the shared peripheral{sharedOthers.length === 1 ? '' : 's'} and unlink
                    {sharedOthers.length === 1 ? ' it' : ' them'} from every asset: {sharedOthers.join('; ')}
                    <span className="field-hint">Left unticked, a shared peripheral only comes off this asset.</span>
                  </span>
                </label>
              )}
            </div>
          )}

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
