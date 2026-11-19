import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Check, CheckCheck, ClipboardCheck, Copy, Pencil, Trash2, X,
} from 'lucide-react';
import api, { errorMessage } from '../api';
import AssetModal from '../components/AssetModal';
import Banner from '../components/Banner';
import SearchBox from '../components/SearchBox';
import SecretSerial from '../components/SecretSerial';
import { useAssets } from '../context/AssetsContext';
import { useAuth } from '../context/AuthContext';
import { formatDate } from '../lib/dates';
import { TOPIC, useLiveTick } from '../lib/live';
import { useLongPress } from '../lib/longPress';
import { cloneAsset } from '../lib/schema';
import { joinRecorded } from '../lib/notRecorded';
import { REGISTER_LIST, SOFTWARE } from '../lib/registers';
import {
  REJECTED, STATE_FILTERS, WHO_FILTERS, countByState, entries, filterWaiting,
  notifyVerificationChanged, verifiedMessage,
} from '../lib/verification';
import './VerificationPage.css';

const DecisionModal = ({ kind, row, onClose, onDone }) => {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const reject = kind === 'reject';
  const label = row.assetTag || row.model || row.assetId;

  const submit = async () => {
    if (reject && !reason.trim()) {
      setError('Say what needs correcting, so whoever fixes it knows.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const body = { register: row.register, id: row.id, reason: reason.trim() };
      await api.post(reject ? '/verification/reject' : '/verification/discard', body);
      onDone(reject
        ? `${row.assetId} sent back: “${reason.trim()}”. It stays here until it is corrected or discarded.`
        : `${row.assetId} discarded. It never entered the register; its trail is kept.`);
    } catch (err) {
      setError(errorMessage(err, reject ? 'Could not send it back.' : 'Could not discard it.'));
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}>
      <div className="modal verify-modal" role="dialog" aria-labelledby="verifyDecisionTitle">
        <div className="modal-head">
          <h2 id="verifyDecisionTitle">{reject ? 'Send back for correction' : 'Discard this entry'}</h2>
          <button type="button" className="modal-close" onClick={onClose} title="Close" disabled={saving}>
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">
          {error && <div className="banner banner-error">{error}</div>}
          <p className="verify-lede">
            <strong>{label}</strong> ({row.assetId}){' '}
            {reject
              ? 'stays in Verification, marked as sent back, with your reason beside it. '
              + 'Correcting it puts it back in the queue.'
              : 'is removed without ever entering the register. Its history and your reason are '
              + 'kept in the Activity Log. This cannot be undone.'}
          </p>
          <div className="field">
            <label htmlFor="verifyReason">{reject ? 'What needs correcting? *' : 'Reason (optional)'}</label>
            <textarea
              id="verifyReason"
              className="field-input verify-reason"
              rows={3}
              maxLength={500}
              value={reason}
              onChange={(e) => { setReason(e.target.value); setError(''); }}
              placeholder={reject ? 'e.g. Serial number does not match the device' : 'e.g. Entered twice'}
              disabled={saving}
              autoFocus
            />
          </div>
        </div>
        <div className="modal-foot">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button
            type="button"
            className={reject ? 'btn-primary' : 'btn-danger'}
            onClick={submit}
            disabled={saving || (reject && !reason.trim())}
          >
            {reject ? <><X size={14} /> {saving ? 'Sending…' : 'Send back'}</>
              : <><Trash2 size={14} /> {saving ? 'Discarding…' : 'Discard'}</>}
          </button>
        </div>
      </div>
    </div>
  );
};

const VerificationPage = () => {
  const { setRegister, invalidateAll, fetchRecord } = useAssets();
  const { canDiscard, canWrite } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState(null);
  const [banner, setBanner] = useState(null);
  const [state, setState] = useState('all');
  const [register, setRegisterFilter] = useState('all');
  const [who, setWho] = useState('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const { bind: longPress, pressing, flash } = useLongPress();
  const [busy, setBusy] = useState(false);
  const [decision, setDecision] = useState(null);
  const [editing, setEditing] = useState(null);

  const [reloadKey, setReloadKey] = useState(0);
  const load = useCallback(() => setReloadKey((k) => k + 1), []);
  // Others' entries and decisions appear as they happen; held while a
  // decision or edit dialog is open.
  const liveTick = useLiveTick(TOPIC.verification, { paused: Boolean(decision || editing) });

  useEffect(() => {
    let live = true;
    api.get('/verification')
      .then((res) => {
        if (!live) return;
        const items = res.data?.items || [];
        setRows(items);
        // Forget ticks on entries that have left the queue.
        setSelected((prev) => {
          const here = new Set(items.map((r) => r.id));
          const kept = [...prev].filter((id) => here.has(id));
          return kept.length === prev.size ? prev : new Set(kept);
        });
      })
      .catch((err) => {
        if (!live) return;
        setRows((prev) => prev || []);
        setBanner({ text: errorMessage(err, 'Could not load the entries waiting for verification.'), kind: 'error' });
      });
    return () => { live = false; };
  }, [reloadKey, liveTick]);

  const counts = useMemo(() => countByState(rows), [rows]);
  const shown = useMemo(
    () => filterWaiting(rows, { state, query, register, who }),
    [rows, state, query, register, who],
  );
  // Verify takes entries that are not on hold and someone else entered --
  // a superadmin (maker and checker) may verify their own too. The server
  // says which per row (canVerify).
  const canVerifyRow = (r) => (typeof r.canVerify === 'boolean'
    ? r.canVerify : !r.enteredByYou && r.verification !== REJECTED);
  // Admins and superadmins may also tick their own and sent-back entries --
  // to clone them. Verify still skips those.
  const canPick = (r) => canWrite || canVerifyRow(r);
  const shownIds = shown.filter(canVerifyRow).map((r) => r.id);
  const selectedShown = shown.filter((r) => canPick(r) && selected.has(r.id));
  const toVerify = selectedShown.filter(canVerifyRow);
  const allShownSelected = shownIds.length > 0 && shownIds.every((id) => selected.has(id));
  const cloneSource = selectedShown.length === 1 ? selectedShown[0] : null;

  const cloneSelected = () => {
    if (!cloneSource) return;
    setRegister(cloneSource.register);
    navigate('/data-entry', {
      state: {
        cloneValues: cloneAsset(cloneSource, cloneSource.register),
        cloneRegister: cloneSource.register,
        cloneFrom: cloneSource.assetId,
      },
    });
  };

  const afterChange = async (message, kind = 'success') => {
    setBanner({ text: message, kind });
    setSelected(new Set());
    invalidateAll();
    notifyVerificationChanged();
    load();
  };

  const verify = async (items) => {
    if (!items.length) return;
    setBusy(true);
    try {
      const res = await api.post('/verification/verify', {
        items: items.map((r) => ({ register: r.register, id: r.id })),
      });
      await afterChange(verifiedMessage(res.data));
    } catch (err) {
      setBanner({ text: errorMessage(err, 'Could not verify.'), kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const toggleAll = () => setSelected((prev) => {
    const next = new Set(prev);
    if (allShownSelected) shownIds.forEach((id) => next.delete(id));
    else shownIds.forEach((id) => next.add(id));
    return next;
  });

  const openEdit = async (row) => {
    setBusy(true);
    try {
      const record = await fetchRecord(row.id, row.register);
      setRegister(row.register);
      setEditing({ record, row });
    } catch (err) {
      setBanner({ text: errorMessage(err, 'Could not open this entry.'), kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const filtered = state !== 'all' || register !== 'all' || who !== 'all' || query.trim() !== '';
  let countLine;
  if (rows === null) countLine = 'Loading…';
  else if (!rows.length) countLine = 'Nothing is waiting — every entry has been verified.';
  else if (!shown.length) countLine = 'No entries match these filters.';
  else {
    countLine = `${entries(shown.length)}${filtered ? ` of ${rows.length.toLocaleString('en-IN')}` : ''}`
      + (selectedShown.length ? ` · ${selectedShown.length.toLocaleString('en-IN')} selected` : '');
  }

  return (
    <div className="page-scroll verification-page">
      <div className="page-card">
        <div className="page-header">
          <h1><ClipboardCheck size={19} /> Verification</h1>
        </div>

        <Banner banner={banner} onDismiss={() => setBanner(null)} />

        <div className="verify-filters">
          <div className="verify-chips" role="tablist" aria-label="Show">
            {STATE_FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                role="tab"
                aria-selected={state === f.key}
                className={`verify-chip${state === f.key ? ' active' : ''}${f.key === REJECTED ? ' is-rejected' : ''}`}
                onClick={() => setState(f.key)}
              >
                {f.label}
                <span className="verify-chip-count">{(counts[f.key] || 0).toLocaleString('en-IN')}</span>
              </button>
            ))}
          </div>
          <select value={register} onChange={(e) => setRegisterFilter(e.target.value)} aria-label="Register">
            <option value="all">Assets and peripherals</option>
            {REGISTER_LIST.map((reg) => <option key={reg.key} value={reg.key}>{reg.label}</option>)}
          </select>
          <select value={who} onChange={(e) => setWho(e.target.value)} aria-label="Entered by">
            {WHO_FILTERS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
          <SearchBox
            value={query}
            onChange={setQuery}
            placeholder="Search ID, serial, name, who entered it…"
            label="Search the entries waiting for verification"
          />
        </div>

        <div className="verify-bar">
          <span className="verify-count">{countLine}</span>
          <div className="verify-actions">
            {canWrite && (
              <button
                type="button"
                className="btn-secondary verify-btn"
                onClick={cloneSelected}
                disabled={busy || !cloneSource}
                title={cloneSource
                  ? `Open Data Entry pre-filled from ${cloneSource.assetId}`
                  : 'Tick exactly one entry to clone it'}
              >
                <Copy size={14} /> Clone
              </button>
            )}
            <button
              type="button"
              className="btn-primary verify-btn"
              onClick={() => verify(toVerify)}
              disabled={busy || !toVerify.length}
              title={toVerify.length < selectedShown.length
                ? 'Accept the selected entries you may verify into the register. Your own and '
                + 'sent-back entries are left as they are.'
                : 'Accept the selected entries into the register'}
            >
              <CheckCheck size={14} />
              {toVerify.length ? `Verify ${entries(toVerify.length)}` : 'Verify selected'}
            </button>
          </div>
        </div>

        <div className="data-table-wrap verify-table-wrap">
          <table className="data-table verify-table">
            <thead>
              <tr>
                <th className="verify-check">
                  <input
                    type="checkbox"
                    checked={allShownSelected}
                    onChange={toggleAll}
                    disabled={!shownIds.length}
                    aria-label="Select every entry shown"
                  />
                </th>
                <th>SAP ID</th>
                <th>Serial Number</th>
                <th>PO Number</th>
                <th>Type</th>
                <th>Model</th>
                <th>Description</th>
                <th>Site / Floor</th>
                <th>Date of Purchase</th>
                <th className="verify-actions-col">Decide</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => {
                const rejected = row.verification === REJECTED;
                const mine = Boolean(row.enteredByYou);
                const onHold = rejected && !mine;
                return (
                  <tr key={`${row.register}-${row.id}`}
                    {...longPress(row.id, () => toggle(row.id), canPick(row))}
                    className={[
                      rejected ? 'verify-row-rejected' : '',
                      mine ? 'verify-row-mine' : '',
                      'longpress-row',
                      canPick(row) && selected.has(row.id) ? 'row-selected' : '',
                      pressing === row.id ? 'row-pressing' : '',
                      flash === row.id && selected.has(row.id) ? 'row-flash' : '',
                    ].filter(Boolean).join(' ')}>
                    <td className="verify-check">
                      <input
                        type="checkbox"
                        checked={canPick(row) && selected.has(row.id)}
                        onChange={() => toggle(row.id)}
                        disabled={!canPick(row)}
                        title={!canVerifyRow(row)
                          ? `${canWrite ? 'Tick to clone it. ' : ''}${rejected
                            ? 'Sent back, so it is on hold until it is corrected'
                            : 'You entered this, so another verifier has to verify it'}.`
                          : mine ? 'You entered this — as superadmin you can verify it yourself' : undefined}
                        aria-label={`Select ${row.assetTag || row.model || row.assetId}`}
                      />
                    </td>
                    <td>{row.sapId || '—'}</td>
                    <td className="verify-srl">
                      {String(row.srl ?? '').trim() ? <SecretSerial record={row} /> : '—'}
                    </td>
                    <td>{row.poNo || '—'}</td>
                    <td className="verify-wrap">{row.register === SOFTWARE ? 'SOFTWARE' : (row.type || '—')}</td>
                    <td className="verify-name verify-wrap">
                      {row.register === SOFTWARE
                        ? ([row.assetTag, row.version && `Version ${row.version}`].filter(Boolean).join(' · ') || '—')
                        : (row.model || '—')}
                      {rejected && row.verificationNote && (
                        <div className="verify-note" title={row.verificationNote}>
                          {mine ? 'Sent back to you' : 'Sent back'}: {row.verificationNote}
                          {row.verifiedBy ? <span className="verify-note-by"> — {row.verifiedBy}</span> : null}
                        </div>
                      )}
                      {!rejected && row.verificationNote && (
                        <div className="verify-note is-was" title={row.verificationNote}>
                          Was sent back: {row.verificationNote}
                        </div>
                      )}
                    </td>
                    <td className="verify-wrap verify-desc">{row.register === SOFTWARE ? '—' : (row.description || '—')}</td>
                    <td className="verify-wrap">{row.register === SOFTWARE ? (row.vendor || '—')
                      : joinRecorded([row.site || row.location, row.floor])}</td>
                    <td className="verify-dop">{row.register === SOFTWARE ? '—' : (formatDate(row.dop) || '—')}</td>
                    <td className="verify-actions-col">
                      <div className="verify-row-actions">
                        {mine && rejected && (
                          <button type="button" className="verify-act is-verify" disabled={busy}
                            onClick={() => openEdit(row)} title="Correct it and send it for verification again"
                            aria-label="Correct and resubmit">
                            <Pencil size={14} />
                          </button>
                        )}
                        {onHold && (
                          <span className="verify-waiting-other"
                            title="It can be verified once whoever entered it has corrected and resubmitted it">
                            On hold — with {row.createdBy || 'whoever entered it'} for correction
                          </span>
                        )}
                        {canVerifyRow(row) && (
                          <button type="button" className="verify-act" disabled={busy}
                            onClick={() => verify([row])}
                            title={mine ? 'Verify your own entry — accept it into the register'
                              : 'Verify — accept into the register'}
                            aria-label="Verify">
                            <Check size={15} />
                          </button>
                        )}
                        {!rejected && (
                          <button type="button" className="verify-act" disabled={busy}
                            onClick={() => openEdit(row)} title="Edit — correct it before verifying"
                            aria-label="Edit">
                            <Pencil size={14} />
                          </button>
                        )}
                        {!rejected && !mine && (
                          <button type="button" className="verify-act" disabled={busy}
                            onClick={() => setDecision({ kind: 'reject', row })} title="Send back with a reason"
                            aria-label="Send back">
                            <X size={15} />
                          </button>
                        )}
                        {canDiscard && (
                          <button type="button" className="verify-act is-danger" disabled={busy}
                            onClick={() => setDecision({ kind: 'discard', row })} title="Discard — remove this entry"
                            aria-label="Discard">
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows !== null && !shown.length && (
            <div className="verify-empty">
              {rows.length ? 'Nothing matches these filters.' : 'All caught up. New entries from Data Entry will appear here.'}
            </div>
          )}
          {rows === null && <div className="verify-empty">Loading&hellip;</div>}
        </div>
      </div>

      {decision && (
        <DecisionModal
          kind={decision.kind}
          row={decision.row}
          onClose={() => setDecision(null)}
          onDone={(text) => { setDecision(null); afterChange(text, decision.kind === 'reject' ? 'info' : 'success'); }}
        />
      )}

      {editing && (
        <AssetModal
          asset={editing.record}
          sentBack={editing.row.verification === REJECTED
            ? { note: editing.row.verificationNote, by: editing.row.verifiedBy } : null}
          editableOnly
          onSaved={() => {
            if (editing.row.verification === REJECTED) {
              setBanner({
                text: `${editing.row.assetId} corrected and sent for verification again.`,
                kind: 'success',
              });
            }
          }}
          onClose={() => {
            setEditing(null);
            load();
            notifyVerificationChanged();
          }}
        />
      )}
    </div>
  );
};

export default VerificationPage;
