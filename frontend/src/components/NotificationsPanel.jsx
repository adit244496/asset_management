import { useCallback, useEffect, useState } from 'react';
import {
  Archive, ArrowLeftRight, CalendarClock, ClipboardCheck, Download, Mail, PackagePlus, RefreshCw, Send,
  Trash2, Undo2, UserPlus, Users, X,
} from 'lucide-react';
import api, { errorMessage } from '../api';
import { formatDate, formatDateTime } from '../lib/dates';
import Banner from './Banner';
import './NotificationsPanel.css';

const MODE_OPTIONS = [
  { value: 'off', label: 'Off', hint: 'Nothing is emailed. Scrapping and selling work as they always have.' },
  { value: 'inform', label: 'Inform', hint: 'The change happens straight away. The IT head and Also inform are emailed about it.' },
  { value: 'approve', label: 'Require the IT head’s approval', hint: 'Nothing is scrapped or sold until the IT head approves from the email; the records are locked meanwhile. Also inform gets an info copy, then the outcome.' },
];

const splitEmails = (text) => String(text || '').split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
const looksLikeEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

const EmailListInput = ({ id, value, onChange, placeholder = 'name@ambujaneotia.com — Enter to add' }) => {
  const [draft, setDraft] = useState('');
  const list = splitEmails(value);

  const commit = (extra) => {
    const add = splitEmails(extra ?? draft);
    if (!add.length) return;
    const seen = new Set(list.map((a) => a.toLowerCase()));
    const next = [...list];
    add.forEach((a) => { if (!seen.has(a.toLowerCase())) { seen.add(a.toLowerCase()); next.push(a); } });
    onChange(next.join(', '));
    setDraft('');
  };
  const remove = (i) => onChange(list.filter((_, n) => n !== i).join(', '));
  const edit = (i) => {
    const rest = list.filter((_, n) => n !== i);
    const taken = new Set(rest.map((a) => a.toLowerCase()));
    const pending = splitEmails(draft).filter((a) => !taken.has(a.toLowerCase()));
    onChange([...rest, ...pending].join(', '));
    setDraft(list[i]);
  };

  return (
    <div className="notify-chips" onClick={() => document.getElementById(id)?.focus()}>
      {list.map((addr, i) => (
        <span key={addr} className={`notify-chip${looksLikeEmail(addr) ? '' : ' bad'}`}
          title={looksLikeEmail(addr) ? 'Click to edit' : 'This does not look like an email address'}>
          <button type="button" className="notify-chip-text" onClick={(e) => { e.stopPropagation(); edit(i); }}>
            {addr}
          </button>
          <button type="button" className="notify-chip-x" aria-label={`Remove ${addr}`}
            onClick={(e) => { e.stopPropagation(); remove(i); }}>
            <X size={11} />
          </button>
        </span>
      ))}
      <input id={id} className="notify-chips-input" type="text" value={draft}
        placeholder={list.length ? 'Add another…' : placeholder}
        onChange={(e) => {
          const v = e.target.value;
          if (/[,;\s]$/.test(v)) commit(v); else setDraft(v);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          if (e.key === 'Backspace' && !draft && list.length) remove(list.length - 1);
        }}
        onPaste={(e) => {
          e.preventDefault();
          commit(`${draft} ${e.clipboardData.getData('text')}`);
        }}
        onBlur={() => commit()} />
    </div>
  );
};

const Notice = ({ icon: Icon, title, to, children }) => (
  <div className="notify-event">
    <div className="notify-event-head">
      <h4><Icon size={14} /> {title}</h4>
      <span className="notify-to">{to}</span>
    </div>
    {children}
  </div>
);

const STATUS_LABELS = {
  pending: 'Waiting', approved: 'Approved', rejected: 'Rejected', withdrawn: 'Withdrawn', failed: 'Could not apply',
};

const EMPTY = {
  mode: 'off', itHeadEmail: '', ccEmails: '', smtpHost: '', smtpPort: 587, smtpSecurity: 'starttls',
  smtpUsername: '', smtpPassword: '', fromAddress: '', appBaseUrl: '', summaryEnabled: true,
  summaryTime: '18:00', passwordSaved: false,
  joinerEnabled: false, joinerDays: 7, transferEnabled: false, registrationEnabled: false,
  verificationEnabled: false, renewalEnabled: false, renewalTime: '09:00',
  exportEnabled: false, exportRecipients: '', exportIntervalDays: 7, exportTime: '09:00',
  exportClearActivity: true,
};

const everyDays = (n) => (Number(n) === 1 ? 'every day' : `every ${n} days`);
const kb = (bytes) => `${Math.max(1, Math.round(bytes / 1024)).toLocaleString('en-IN')} KB`;

const RENEWAL_STAGE = { 30: '30-day notice', 15: '15-day notice', daily: 'Daily, with the IT head' };
const renewalWhen = (days) => (days < 0 ? `overdue ${-days} d` : days === 0 ? 'today' : `in ${days} d`);

const when = formatDateTime;

const NotificationsPanel = () => {
  const [form, setForm] = useState(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [banner, setBanner] = useState(null);
  const [requests, setRequests] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [renewals, setRenewals] = useState(null);
  const [exporting, setExporting] = useState(null);

  const loadRequests = useCallback(async () => {
    try {
      const res = await api.get('/approvals');
      setRequests(res.data?.items || []);
    } catch (err) {
      setRequests([]);
      setBanner({ text: errorMessage(err, 'Could not load the approval requests.'), kind: 'error' });
    }
  }, []);

  useEffect(() => {
    let live = true;
    api.get('/notifications/settings')
      .then((res) => { if (live) setForm({ ...EMPTY, ...res.data, smtpPassword: '' }); })
      .catch((err) => { if (live) setBanner({ text: errorMessage(err, 'Could not load the settings.'), kind: 'error' }); })
      .finally(() => { if (live) setLoaded(true); });
    api.get('/approvals')
      .then((res) => { if (live) setRequests(res.data?.items || []); })
      .catch(() => { if (live) setRequests([]); });
    api.get('/notifications/renewals')
      .then((res) => { if (live) setRenewals(res.data); })
      .catch(() => { if (live) setRenewals({ upcoming: [] }); });
    return () => { live = false; };
  }, []);

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const save = async (extra = {}) => {
    setSaving(true);
    setBanner(null);
    try {
      const res = await api.put('/notifications/settings', { ...form, ...extra });
      setForm({ ...EMPTY, ...res.data, smtpPassword: '' });
      setBanner({ text: 'Notification settings saved.', kind: 'success' });
    } catch (err) {
      setBanner({ text: errorMessage(err, 'Could not save the settings.'), kind: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    setTesting(true);
    setBanner(null);
    try {
      const res = await api.post('/notifications/test', {});
      setBanner({ text: `Test email sent to ${res.data.to}. Check that inbox.`, kind: 'success' });
    } catch (err) {
      setBanner({ text: errorMessage(err, 'The test email could not be sent.'), kind: 'error' });
    } finally {
      setTesting(false);
    }
  };

  const downloadExport = async () => {
    setExporting('download');
    setBanner(null);
    try {
      const res = await api.post('/notifications/export/download', {}, { responseType: 'blob' });
      const name = /filename="?([^";]+)"?/.exec(res.headers?.['content-disposition'] || '')?.[1]
        || 'it-asset-export.zip';
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setBanner({ text: `Downloaded ${name} (${kb(res.data.size)}) — the same zip the email carries.`, kind: 'success' });
    } catch (err) {
      let text = errorMessage(err, 'Could not build the data export.');
      if (err.response?.data instanceof Blob) {
        try {
          const body = JSON.parse(await err.response.data.text());
          if (body?.detail) text = [].concat(body.detail).join(' ');
        } catch {  }
      }
      setBanner({ text, kind: 'error' });
    } finally {
      setExporting(null);
    }
  };

  const sendExportNow = async () => {
    setExporting('send');
    setBanner(null);
    try {
      const res = await api.post('/notifications/export/send', {});
      const c = res.data.counts || {};
      setBanner({
        text: `Data export emailed to ${res.data.to.join(', ')}: ${res.data.file} (${kb(res.data.bytes)}) — `
          + `${c.assets} assets, ${c.peripherals} peripherals, ${c.softwares} softwares and `
          + `${c.activity} activity entries from ${c.activityFrom} to ${c.activityTo}.`
          + (res.data.cleared !== null && res.data.cleared !== undefined
            ? ' The Activity Log has been cleared.' : ''),
        kind: 'success',
      });
      if (res.data.clearedAt) set('activityClearedAt', res.data.clearedAt);
    } catch (err) {
      setBanner({ text: errorMessage(err, 'The data export could not be sent.'), kind: 'error' });
    } finally {
      setExporting(null);
    }
  };

  const act = async (req, action) => {
    if (action === 'withdraw' && !window.confirm('Withdraw this request? Nothing will be scrapped or sold, '
      + 'the records are unlocked, and the links in the IT head’s email stop working.')) return;
    setBusyId(req.id);
    try {
      await api.post(`/approvals/${req.id}/${action}`);
      setBanner({
        text: action === 'withdraw' ? 'Request withdrawn. The records are unlocked.'
          : 'A fresh approval email is on its way to the IT head.',
        kind: 'success',
      });
      await loadRequests();
    } catch (err) {
      setBanner({ text: errorMessage(err, 'Could not do that.'), kind: 'error' });
    } finally {
      setBusyId(null);
    }
  };

  if (!loaded) return <p className="notify-muted">Loading&hellip;</p>;

  const sending = form.mode !== 'off' || form.joinerEnabled || form.transferEnabled
    || form.registrationEnabled || form.verificationEnabled || form.renewalEnabled;
  const mailing = sending || form.exportEnabled;
  const exportTo = splitEmails(form.exportRecipients);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const informCount = splitEmails(form.ccEmails).length;
  const plusInform = informCount ? ` · Cc Also inform (${informCount})` : '';

  return (
    <div className="notify-panel">
      <Banner banner={banner} onDismiss={() => setBanner(null)} />

      <section className="notify-section">
        <h3><Users size={15} /> Who is emailed</h3>
        <div className="notify-grid">
          <div className="field">
            <label htmlFor="nIthead">IT head’s email {sending ? '*' : ''}</label>
            <EmailListInput id="nIthead" value={form.itHeadEmail} onChange={(v) => set('itHeadEmail', v)}
              placeholder="ithead@ambujaneotia.com — Enter to add" />
            <p className="field-hint">
              One or more addresses — type or paste them and press Enter. Each receives every notice
              below and the approval links; the first to approve or reject decides.
            </p>
          </div>
          <div className="field notify-span2">
            <label htmlFor="nCc">Also inform</label>
            <EmailListInput id="nCc" value={form.ccEmails} onChange={(v) => set('ccEmails', v)} />
            <p className="field-hint">
              As many addresses as needed — type or paste them and press Enter; click one to edit it.
              Copied on every notice, outcome and summary — never on an email with approval links.
            </p>
          </div>
        </div>
      </section>

      <section className="notify-section">
        <h3><Mail size={15} /> What is emailed</h3>

        <Notice icon={Trash2} title="An asset is scrapped or sold"
          to={form.mode === 'approve' ? `Approval: IT head${informCount ? ' · Info: Also inform' : ''}`
            : `To the IT head${plusInform}`}>
          <div className="notify-modes" role="radiogroup" aria-label="Scrap and sale emails">
            {MODE_OPTIONS.map((m) => (
              <label key={m.value} className={`notify-mode${form.mode === m.value ? ' active' : ''}`}>
                <input type="radio" name="notify-mode" value={m.value} checked={form.mode === m.value}
                  onChange={() => set('mode', m.value)} />
                <span className="notify-mode-label">{m.label}</span>
                <span className="notify-mode-hint">{m.hint}</span>
              </label>
            ))}
          </div>
        </Notice>

        <Notice icon={ArrowLeftRight} title="An asset is transferred"
          to={`To the IT head and the assignee${plusInform}`}>
          <label className="notify-check notify-check-top">
            <input type="checkbox" checked={form.transferEnabled}
              onChange={(e) => set('transferEnabled', e.target.checked)} />
            Send an info email
          </label>
          <p className="notify-muted notify-explain">
            Sent for the Transfer action: where it moved from and to, who held it and who holds it now.
            The assignee is the person it was transferred to (or, for a peripheral, whoever holds the
            asset it went onto). A transfer that changes nothing sends nothing.
          </p>
        </Notice>

        <Notice icon={PackagePlus} title="A new asset is registered" to={`To the IT head${plusInform}`}>
          <label className="notify-check notify-check-top">
            <input type="checkbox" checked={form.registrationEnabled}
              onChange={(e) => set('registrationEnabled', e.target.checked)} />
            Send an info email
          </label>
          <p className="notify-muted notify-explain">
            Sent when records enter the register — added from Data Entry, uploaded, or accepted from
            Verification when new entries wait there. One email per action: an upload of 500 rows is
            one email listing them, not 500. Entries accepted from Verification are collected: once
            verifying has paused for 10 minutes (or after an hour at most), one email lists everything
            verified, grouped by PO number — a bulk order verified row by row is one email.
          </p>
        </Notice>

        <Notice icon={ClipboardCheck} title="An entry waits for verification, or is sent back"
          to="To the verifiers · or to whoever entered it">
          <label className="notify-check notify-check-top">
            <input type="checkbox" checked={form.verificationEnabled}
              onChange={(e) => set('verificationEnabled', e.target.checked)} />
            Send these emails
          </label>
          <p className="notify-muted notify-explain">
            New entries waiting in Verification — added from Data Entry, uploaded, or corrected
            after being sent back — email every account that can verify (superadmin, admin,
            verifier), except whoever entered them. An entry sent back emails the person who
            entered it, with the reason. These go to each person’s own Email ID (Master Data &gt;
            Users), so set one on every account that should receive them.
          </p>
        </Notice>

        <Notice icon={UserPlus} title="A new joiner is handed an asset"
          to={`To the IT head and the new assignee${plusInform}`}>
          <label className="notify-check notify-check-top">
            <input type="checkbox" checked={form.joinerEnabled}
              onChange={(e) => set('joinerEnabled', e.target.checked)} />
            Send an info email
          </label>
          <p className="notify-muted notify-explain">
            Someone counts as a new joiner when their record in Master Data &gt; Users was created at
            most this many days before the hand-over. A hand-over is an asset getting a new Assigned
            User — from Data Entry, Edit, Transfer, Bulk Edit or the assistant; an entry waiting in
            Verification is judged when it is accepted. Bulk uploads are not hand-overs, so they never
            send this.
          </p>
          <div className="field notify-port">
            <label htmlFor="nDays">New joiner window (days)</label>
            <input id="nDays" className="field-input" type="number" min="1" max="90"
              value={form.joinerDays} onChange={(e) => set('joinerDays', e.target.value)} />
          </div>
        </Notice>

        <Notice icon={CalendarClock} title="A software is nearing its renewal date"
          to="Also inform at 30 and 15 days · the IT head, with Also inform, daily from 7 days">
          <label className="notify-check notify-check-top">
            <input type="checkbox" checked={form.renewalEnabled}
              onChange={(e) => set('renewalEnabled', e.target.checked)} />
            Send renewal reminders
          </label>
          <p className="notify-muted notify-explain">
            Checked once a day, against each software’s Renewal Date. <strong>30 days</strong> before
            and again <strong>15 days</strong> before, Also inform is emailed. From <strong>7 days</strong>
            {' '}before, the IT head is emailed <strong>every day</strong>, with Also inform copied —
            through the renewal date and past it, until the Renewal Date is updated or the software is
            scrapped or sold. Each day’s email lists every licence due, so ten licences are one email.
          </p>
          {form.renewalEnabled && !informCount && (
            <p className="notify-warn">
              Also inform has no addresses, so the 30- and 15-day reminders have no one to go to. Add
              them above; a reminder that could not be sent goes out once there is someone to send it to.
            </p>
          )}
          <div className="field notify-port">
            <label htmlFor="nRenewTime">Send at</label>
            <input id="nRenewTime" className="field-input" type="time" value={form.renewalTime}
              disabled={!form.renewalEnabled} onChange={(e) => set('renewalTime', e.target.value)} />
          </div>
          {renewals && (
            <div className="notify-renewals">
              <div className="notify-renewals-head">
                Within 30 days of renewal: {renewals.upcoming.length}
                {form.lastRenewalOn && <span className="notify-muted"> · last checked {form.lastRenewalOn}</span>}
              </div>
              {renewals.upcoming.length > 0 && (
                <table className="notify-renewals-table">
                  <tbody>
                    {renewals.upcoming.map((u) => (
                      <tr key={u.id} className={u.days < 0 ? 'is-overdue' : u.stage === 'daily' ? 'is-soon' : ''}>
                        <td className="notify-renewals-id">{u.assetId}</td>
                        <td className="notify-renewals-name">{u.name}</td>
                        <td className="notify-renewals-date">{formatDate(u.renewalDate)}</td>
                        <td className="notify-renewals-when">{renewalWhen(u.days)}</td>
                        <td className="notify-muted notify-renewals-stage">{RENEWAL_STAGE[u.stage]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </Notice>
      </section>

      <section className="notify-section">
        <h3><Archive size={15} /> Scheduled data export</h3>
        <p className="notify-muted notify-explain">
          One email with a zip attached: <strong>assets</strong>, <strong>peripherals</strong> and
          {' '}<strong>softwares</strong> CSVs — each register as the Report exports it — the
          {' '}<strong>Activity Log</strong> from the previous export to the day it is sent, and the
          {' '}<strong>Master Data workbook</strong> — a sheet per list and one for Users, as Download all
          saves it on Master Data. Every file is named with its date, e.g.
          {' '}<code>assets-2026-10-22.csv</code>, <code>master-data-2026-10-22.xlsx</code>. It goes
          {' '}<strong>only</strong> to the addresses below, not to the IT head or Also inform.
        </p>
        <label className="notify-check notify-check-top">
          <input type="checkbox" checked={form.exportEnabled}
            onChange={(e) => set('exportEnabled', e.target.checked)} />
          Email the data export {everyDays(form.exportIntervalDays || 7)}
        </label>
        <div className="notify-grid">
          <div className="field notify-span2">
            <label htmlFor="nExportTo">Send to {form.exportEnabled ? '*' : ''}</label>
            <EmailListInput id="nExportTo" value={form.exportRecipients}
              onChange={(v) => set('exportRecipients', v)} />
            <p className="field-hint">Type or paste the addresses and press Enter; click one to edit it.</p>
          </div>
          <div className="field notify-port">
            <label htmlFor="nExportDays">Every (days)</label>
            <input id="nExportDays" className="field-input" type="number" min="1" max="365"
              value={form.exportIntervalDays} onChange={(e) => set('exportIntervalDays', e.target.value)} />
          </div>
          <div className="field notify-port">
            <label htmlFor="nExportTime">At</label>
            <input id="nExportTime" className="field-input" type="time" value={form.exportTime}
              onChange={(e) => set('exportTime', e.target.value)} />
          </div>
        </div>
        {form.exportEnabled && !exportTo.length && (
          <p className="notify-warn">Add at least one address to send the data export to.</p>
        )}
        <label className="notify-check">
          <input type="checkbox" checked={form.exportClearActivity}
            onChange={(e) => set('exportClearActivity', e.target.checked)} />
          Clear the Activity Log after each email
        </label>
        <p className="field-hint">
          Each email — scheduled or Send now — then carries the <strong>whole</strong> Activity Log,
          and once the mail server has accepted it the log is emptied, so the Activity page starts
          afresh. Each record’s own History is kept. Download the zip never clears.
          {form.activityClearedAt && ` Last cleared ${when(form.activityClearedAt)}.`}
        </p>
        <p className="notify-muted notify-export-status">
          {form.lastExportOn ? `Last sent ${formatDate(form.lastExportOn)}.` : 'Not sent on its schedule yet.'}
          {form.nextExportOn && ` Next: ${formatDate(form.nextExportOn)} at ${form.exportTime}.`}
          {' '}Changes here take effect once saved.
        </p>
        <div className="notify-inline">
          <button type="button" className="btn-secondary" onClick={downloadExport}
            disabled={exporting !== null} title="Builds the zip now and downloads it here — nothing is emailed">
            <Download size={14} /> {exporting === 'download' ? 'Building…' : 'Download the zip'}
          </button>
          <button type="button" className="btn-secondary" onClick={sendExportNow}
            disabled={exporting !== null || saving}
            title="Emails the zip now to the SAVED recipients (and clears the Activity Log, if that is ticked and saved); the schedule is unchanged">
            <Send size={14} /> {exporting === 'send' ? 'Sending…' : 'Send now'}
          </button>
        </div>
      </section>

      <section className="notify-section">
        <h3>Mail server</h3>
        <p className="notify-muted">
          The mailbox the app sends from. For Microsoft 365: <code>smtp.office365.com</code>, port
          {' '}<code>587</code>, STARTTLS, and that mailbox’s address and password.
        </p>
        <div className="notify-grid">
          <div className="field">
            <label htmlFor="nHost">SMTP server {mailing ? '*' : ''}</label>
            <input id="nHost" className="field-input" type="text" value={form.smtpHost}
              placeholder="smtp.office365.com" onChange={(e) => set('smtpHost', e.target.value)} />
          </div>
          <div className="field notify-port">
            <label htmlFor="nPort">Port</label>
            <input id="nPort" className="field-input" type="number" min="1" max="65535" value={form.smtpPort}
              onChange={(e) => set('smtpPort', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="nSec">Security</label>
            <select id="nSec" className="field-input" value={form.smtpSecurity}
              onChange={(e) => set('smtpSecurity', e.target.value)}>
              <option value="starttls">STARTTLS (port 587)</option>
              <option value="ssl">SSL / TLS (port 465)</option>
              <option value="none">None (internal relay)</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="nUser">Mailbox (username)</label>
            <input id="nUser" className="field-input" type="text" autoComplete="off" value={form.smtpUsername}
              placeholder="itassets@ambujaneotia.com" onChange={(e) => set('smtpUsername', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="nPass">Password</label>
            <input id="nPass" className="field-input" type="password" autoComplete="new-password"
              value={form.smtpPassword}
              placeholder={form.passwordSaved ? '•••••••• saved — leave blank to keep' : ''}
              onChange={(e) => set('smtpPassword', e.target.value)} />
            {form.passwordSaved && (
              <button type="button" className="notify-link" disabled={saving}
                onClick={() => save({ clearPassword: true, smtpPassword: '' })}>
                Remove the saved password
              </button>
            )}
          </div>
          <div className="field">
            <label htmlFor="nFrom">Send as {mailing ? '*' : ''}</label>
            <input id="nFrom" className="field-input" type="email" value={form.fromAddress}
              placeholder="itassets@ambujaneotia.com" onChange={(e) => set('fromAddress', e.target.value)} />
            <p className="field-hint">Usually the same mailbox.</p>
          </div>
        </div>
      </section>

      <section className="notify-section">
        <h3>Links and the daily summary</h3>
        <div className="notify-grid">
          <div className="field notify-wide">
            <label htmlFor="nBase">Address this app is opened at {form.mode === 'approve' ? '*' : ''}</label>
            <div className="notify-inline">
              <input id="nBase" className="field-input" type="text" value={form.appBaseUrl}
                placeholder={origin} onChange={(e) => set('appBaseUrl', e.target.value)} />
              {origin && form.appBaseUrl !== origin && (
                <button type="button" className="btn-secondary" onClick={() => set('appBaseUrl', origin)}>
                  Use {origin}
                </button>
              )}
            </div>
            <p className="field-hint">
              Approval links in the emails point here, so it must be an address the IT head can open
              — not “localhost” unless they use this same computer.
            </p>
          </div>
          <div className="field">
            <label className="notify-check">
              <input type="checkbox" checked={form.summaryEnabled}
                onChange={(e) => set('summaryEnabled', e.target.checked)} />
              Send a daily summary
            </label>
            <p className="field-hint">What is waiting, what was decided and what was scrapped or sold that day.</p>
          </div>
          <div className="field notify-port">
            <label htmlFor="nTime">At</label>
            <input id="nTime" className="field-input" type="time" value={form.summaryTime}
              disabled={!form.summaryEnabled} onChange={(e) => set('summaryTime', e.target.value)} />
          </div>
        </div>
      </section>

      <div className="notify-actions">
        <button type="button" className="btn-secondary" onClick={sendTest} disabled={testing || saving}
          title="Sends to the IT head’s address, using the SAVED settings">
          <Send size={14} /> {testing ? 'Sending…' : 'Send test email'}
        </button>
        <button type="button" className="btn-primary" onClick={() => save()} disabled={saving}>
          {saving ? 'Saving…' : 'Save settings'}
        </button>
      </div>

      <section className="notify-section">
        <div className="notify-requests-head">
          <h3>Approval requests</h3>
          <button type="button" className="icon-btn" title="Refresh" aria-label="Refresh" onClick={loadRequests}>
            <RefreshCw size={13} />
          </button>
        </div>
        <div className="data-table-wrap master-table-wrap">
          <table className="data-table notify-table">
            <thead>
              <tr>
                <th>Asked</th>
                <th>What</th>
                <th>Records</th>
                <th>Asked by</th>
                <th>Reason</th>
                <th>Status</th>
                <th>Decision</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {requests === null && <tr><td className="table-empty" colSpan={8}>Loading&hellip;</td></tr>}
              {requests && !requests.length && (
                <tr><td className="table-empty" colSpan={8}>No requests yet.</td></tr>
              )}
              {(requests || []).map((r) => {
                const sale = r.changes?.status;
                return (
                  <tr key={r.id}>
                    <td className="notify-nowrap">{when(r.requestedAt)}</td>
                    <td>{r.kind === 'scrap' ? 'Scrap' : `Mark ${sale || 'sold'}`}</td>
                    <td className="notify-ids" title={(r.items || []).map((i) => `${i.assetId} ${i.name || ''}`).join('\n')}>
                      {(r.items || []).slice(0, 3).map((i) => i.assetId).join(', ')}
                      {r.count > 3 ? ` +${r.count - 3} more` : ''}
                    </td>
                    <td>{r.requestedBy}</td>
                    <td className="notify-reason">{r.reason || '—'}</td>
                    <td><span className={`notify-status s-${r.status}`}>{STATUS_LABELS[r.status] || r.status}</span></td>
                    <td className="notify-reason">
                      {r.decidedAt ? `${when(r.decidedAt)}${r.decisionNote ? ` — ${r.decisionNote}` : ''}` : '—'}
                      {r.outcome && r.status !== 'pending' && <div className="notify-outcome">{r.outcome}</div>}
                    </td>
                    <td className="actions-cell">
                      {r.status === 'pending' && (
                        <>
                          <button type="button" className="icon-btn" title="Email the IT head a fresh link"
                            aria-label="Resend" disabled={busyId === r.id} onClick={() => act(r, 'resend')}>
                            <Send size={13} />
                          </button>
                          <button type="button" className="icon-btn icon-btn-danger" title="Withdraw — unlock the records"
                            aria-label="Withdraw" disabled={busyId === r.id} onClick={() => act(r, 'withdraw')}>
                            <Undo2 size={13} />
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

export default NotificationsPanel;
