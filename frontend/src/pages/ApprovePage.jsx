import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Check, X } from 'lucide-react';
import api, { errorMessage } from '../api';
import AppLogo from '../components/AppLogo';
import { formatDateTime, formatIfDate } from '../lib/dates';
import { byKey } from '../lib/schema';
import './ApprovePage.css';

const ApprovePage = () => {
  const { token } = useParams();
  const [params] = useSearchParams();
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [choice, setChoice] = useState(params.get('decision') === 'reject' ? 'reject' : 'approve');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  useEffect(() => {
    let live = true;
    api.get(`/approvals/link/${encodeURIComponent(token)}`)
      .then((res) => { if (live) setInfo(res.data); })
      .catch((err) => { if (live) setError(errorMessage(err, 'This link is not valid.')); });
    return () => { live = false; };
  }, [token]);

  const submit = async () => {
    if (choice === 'reject' && !note.trim()) {
      setError('Say why it is rejected — the person who asked will see it.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await api.post('/approvals/decide', { token, decision: choice, note: note.trim() });
      setDone(res.data);
    } catch (err) {
      setError(errorMessage(err, 'That could not be recorded.'));
    } finally {
      setBusy(false);
    }
  };

  const what = info
    ? (info.kind === 'scrap' ? 'Scrap' : `Mark as ${info.changes?.status || 'sold'}`)
    : '';
  const held = info ? Object.entries(info.changes || {})
    .filter(([k, v]) => k !== 'linkedPeripheralIds' && String(v ?? '').trim()) : [];

  return (
    <div className="approve-page">
      <div className="approve-card">
        <div className="approve-brand"><AppLogo size={22} /> IT Asset Engine</div>

        {!info && !error && <p className="approve-muted">Loading&hellip;</p>}
        {!info && error && <div className="banner banner-error">{error}</div>}

        {info && (
          <>
            <h1>{what}: {info.count} {info.register === 'peripheral' ? 'peripheral' : info.register === 'software' ? 'software' : 'asset'}{info.count === 1 ? '' : 's'}</h1>
            <p className="approve-muted">
              Asked by <b>{info.requestedBy}</b>
              {info.requestedAt ? ` on ${formatDateTime(info.requestedAt)}` : ''}.
            </p>
            {info.reason && <p className="approve-reason">Reason: {info.reason}</p>}
            {held.length > 0 && info.kind === 'sale' && (
              <p className="approve-muted">
                Changes: {held.map(([k, v]) => `${byKey(k)?.label || k} → ${formatIfDate(String(v))}`).join('; ')}
              </p>
            )}

            <div className="approve-table-wrap">
              <table className="approve-table">
                <thead>
                  <tr><th>ID</th><th>Name</th><th>Model</th><th>Srl No.</th><th>Status</th><th>Assigned to</th><th>Location</th></tr>
                </thead>
                <tbody>
                  {(info.items || []).map((i) => (
                    <tr key={i.id}>
                      <td className="approve-id">{i.assetId}</td>
                      <td>{i.name || '—'}</td>
                      <td>{i.model || '—'}</td>
                      <td>{i.srl || '—'}</td>
                      <td>{i.status || '—'}</td>
                      <td>{i.user || '—'}</td>
                      <td>{i.location || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {done ? (
              <div className={`approve-result r-${done.status}`}>
                <b>{done.status === 'rejected' ? 'Rejected.' : done.status === 'approved' ? 'Approved.' : 'Approved, but it could not be applied.'}</b>
                {' '}{done.outcome}
              </div>
            ) : info.canDecide ? (
              <>
                <div className="approve-choice" role="radiogroup" aria-label="Decision">
                  <button type="button" role="radio" aria-checked={choice === 'approve'}
                    className={`approve-option${choice === 'approve' ? ' on-approve' : ''}`}
                    onClick={() => setChoice('approve')}>
                    <Check size={15} /> Approve
                  </button>
                  <button type="button" role="radio" aria-checked={choice === 'reject'}
                    className={`approve-option${choice === 'reject' ? ' on-reject' : ''}`}
                    onClick={() => setChoice('reject')}>
                    <X size={15} /> Reject
                  </button>
                </div>
                <label className="approve-note-label" htmlFor="approveNote">
                  {choice === 'reject' ? 'Why is it rejected? (required)' : 'Note (optional)'}
                </label>
                <textarea id="approveNote" className="approve-note" rows={3} value={note}
                  maxLength={500} onChange={(e) => setNote(e.target.value)} />
                {error && <div className="banner banner-error">{error}</div>}
                <button type="button" className={`approve-submit ${choice}`} onClick={submit} disabled={busy}>
                  {busy ? 'Recording…' : choice === 'approve'
                    ? `Approve — ${info.kind === 'scrap' ? 'scrap' : 'mark sold'} now`
                    : 'Reject — change nothing'}
                </button>
                <p className="approve-muted approve-small">
                  This link works once. The person who asked is told what you decide.
                </p>
              </>
            ) : (
              <div className="banner banner-info">{info.problem}</div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default ApprovePage;
