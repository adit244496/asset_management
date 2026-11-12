import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bot, CheckCircle2, EyeOff, KeyRound, PlugZap, ShieldCheck, Trash2, X, XCircle,
} from 'lucide-react';
import api, { errorMessage } from '../api';
import { formatDateTime } from '../lib/dates';
import { TOPIC, useLiveEvent } from '../lib/live';
import Banner from './Banner';
import './AdminControlsModal.css';

// Admin controls (superadmin only): the AI assistant's provider, model and
// API keys. Keys are write-only -- the server never sends one back, so this
// shows only whether one is saved. Backend: app/api/admin.py.

const MODEL_FIELD = { gemini: 'geminiModel', anthropic: 'claudeModel' };
const KEY_FIELD = { gemini: 'geminiApiKey', anthropic: 'anthropicApiKey' };
const SHORT = { gemini: 'Gemini', anthropic: 'Claude' };
const KEY_HINT = { gemini: 'AIza…', anthropic: 'sk-ant-…' };

const draftOf = (s) => ({
  provider: s.provider,
  geminiModel: s.geminiModel,
  claudeModel: s.claudeModel,
  geminiApiKey: '',
  anthropicApiKey: '',
});

const AdminControlsModal = ({ onClose }) => {
  const [saved, setSaved] = useState(null);
  const [draft, setDraft] = useState(null);
  const [banner, setBanner] = useState(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(null);
  const [tests, setTests] = useState({});
  const [removing, setRemoving] = useState(null);
  const draftRef = useRef(null);
  const savedRef = useRef(null);
  useEffect(() => { draftRef.current = draft; savedRef.current = saved; }, [draft, saved]);

  // Who may reveal software serial numbers (the eye button).
  const [access, setAccess] = useState(null);
  const [accessDraft, setAccessDraft] = useState([]);
  const [savingAccess, setSavingAccess] = useState(false);
  const [accessNote, setAccessNote] = useState(null);
  const accessDirtyRef = useRef(false);
  const showAccess = useCallback((data) => {
    setAccess(data);
    setAccessDraft(data.softwareSerialRoles || []);
  }, []);
  const accessDirty = Boolean(access)
    && [...accessDraft].sort().join() !== [...(access.softwareSerialRoles || [])].sort().join();
  useEffect(() => { accessDirtyRef.current = accessDirty; }, [accessDirty]);

  useEffect(() => {
    let live = true;
    api.get('/admin/access').then((res) => { if (live) showAccess(res.data); }).catch(() => { });
    return () => { live = false; };
  }, [showAccess]);

  useLiveEvent(TOPIC.settings, () => {
    api.get('/admin/access')
      .then((res) => { if (accessDirtyRef.current) setAccess(res.data); else showAccess(res.data); })
      .catch(() => { });
  });

  const toggleRole = (role) => setAccessDraft((list) => (
    list.includes(role) ? list.filter((r) => r !== role) : [...list, role]));

  const saveAccess = async () => {
    setSavingAccess(true);
    setAccessNote(null);
    try {
      const res = await api.put('/admin/access', { softwareSerialRoles: accessDraft });
      showAccess(res.data);
      setAccessNote({ ok: true, text: 'Saved. It applies straight away for everyone.' });
    } catch (err) {
      setAccessNote({ ok: false, text: errorMessage(err, 'Could not save.') });
    } finally {
      setSavingAccess(false);
    }
  };

  const show = useCallback((data) => {
    setSaved(data);
    setDraft(draftOf(data));
  }, []);

  useEffect(() => {
    let live = true;
    api.get('/admin/assistant')
      .then((res) => { if (live) show(res.data); })
      .catch((err) => {
        if (live) setBanner({ text: errorMessage(err, 'Could not load the assistant settings.'), kind: 'error' });
      });
    return () => { live = false; };
  }, [show]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !saving) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  // Another superadmin saved: show it, unless this form has unsaved edits.
  useLiveEvent(TOPIC.assistant, () => {
    api.get('/admin/assistant')
      .then((res) => {
        const d = draftRef.current;
        const s = savedRef.current;
        const untouched = !d || !s || JSON.stringify(d) === JSON.stringify(draftOf(s));
        if (untouched) show(res.data);
        else setSaved(res.data);
      })
      .catch(() => { });
  });

  if (!saved || !draft) {
    return (
      <div className="modal-overlay">
        <div className="modal admin-modal" role="dialog" aria-label="Admin controls">
          <div className="modal-head">
            <h2><ShieldCheck size={18} /> Admin controls</h2>
            <button type="button" className="modal-close" onClick={onClose} title="Close"><X size={18} /></button>
          </div>
          <div className="modal-body">
            <Banner banner={banner} onDismiss={() => setBanner(null)} />
            {!banner && <p className="admin-muted">Loading&hellip;</p>}
          </div>
        </div>
      </div>
    );
  }

  const set = (key, value) => setDraft((d) => ({ ...d, [key]: value }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(draftOf(saved));

  const save = async () => {
    setSaving(true);
    setBanner(null);
    try {
      const body = {
        provider: draft.provider,
        geminiModel: draft.geminiModel,
        claudeModel: draft.claudeModel,
      };
      if (draft.geminiApiKey.trim()) body.geminiApiKey = draft.geminiApiKey.trim();
      if (draft.anthropicApiKey.trim()) body.anthropicApiKey = draft.anthropicApiKey.trim();
      const res = await api.put('/admin/assistant', body);
      show(res.data);
      setTests({});
      setBanner({
        text: res.data.aiEnabled
          ? 'Saved. The assistant uses this from the next question — no restart needed.'
          : `Saved. The assistant is off: there is no ${SHORT[res.data.provider]} API key.`,
        kind: res.data.aiEnabled ? 'success' : 'info',
      });
    } catch (err) {
      setBanner({ text: errorMessage(err, 'Could not save the assistant settings.'), kind: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const removeKey = async (provider) => {
    const inUse = saved.provider === provider;
    const ok = window.confirm(
      `Remove the saved ${SHORT[provider]} API key?\n\n`
      + (inUse ? 'The assistant uses it now, so the assistant switches off for everyone straight away. '
        : '')
      + 'A restart does not bring it back; paste a key again to turn it on.',
    );
    if (!ok) return;
    setRemoving(provider);
    setBanner(null);
    try {
      const res = await api.delete(`/admin/assistant/keys/${provider}`);
      setSaved(res.data);
      setDraft((d) => ({ ...d, [KEY_FIELD[provider]]: '' }));
      setTests((t) => ({ ...t, [provider]: null }));
      setBanner({
        text: `${SHORT[provider]} API key removed.${inUse ? ' The assistant is now off.' : ''}`,
        kind: 'success',
      });
    } catch (err) {
      setBanner({ text: errorMessage(err, 'Could not remove the key.'), kind: 'error' });
    } finally {
      setRemoving(null);
    }
  };

  const test = async (provider) => {
    setTesting(provider);
    setTests((t) => ({ ...t, [provider]: null }));
    try {
      const res = await api.post('/admin/assistant/test', {
        provider,
        apiKey: draft[KEY_FIELD[provider]].trim(),
        model: draft[MODEL_FIELD[provider]].trim(),
      });
      setTests((t) => ({ ...t, [provider]: res.data }));
    } catch (err) {
      setTests((t) => ({ ...t, [provider]: { ok: false, message: errorMessage(err, 'The test could not run.') } }));
    } finally {
      setTesting(null);
    }
  };

  const busy = saving || Boolean(removing);
  const chosen = saved.providers.find((p) => p.key === saved.provider);

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="modal admin-modal" role="dialog" aria-labelledby="adminControlsTitle">
        <div className="modal-head">
          <h2 id="adminControlsTitle"><ShieldCheck size={18} /> Admin controls</h2>
          <button type="button" className="modal-close" onClick={onClose} title="Close" disabled={busy}>
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <Banner banner={banner} onDismiss={() => setBanner(null)} />

          <div className={`admin-status${saved.aiEnabled ? ' is-on' : ' is-off'}`}>
            <Bot size={16} />
            {saved.aiEnabled
              ? <span>The AI assistant is <strong>on</strong>, using {chosen?.label} ({saved.provider === 'anthropic' ? saved.claudeModel : saved.geminiModel}).</span>
              : <span>The AI assistant is <strong>off</strong> — there is no {SHORT[saved.provider]} API key. Its Guide still works.</span>}
          </div>
          <p className="admin-muted">
            Only superadmins see this. Keys are stored encrypted and never shown again; changes apply
            straight away, without restarting the backend. Keys in the server&rsquo;s .env file are not used.
          </p>

          <fieldset className="admin-providers">
            <legend>Provider the assistant uses</legend>
            {saved.providers.map((p) => (
              <label key={p.key} className={`admin-provider${draft.provider === p.key ? ' active' : ''}`}>
                <input
                  type="radio"
                  name="aiProvider"
                  value={p.key}
                  checked={draft.provider === p.key}
                  onChange={() => set('provider', p.key)}
                  disabled={busy}
                />
                <span>{p.label}</span>
                {!saved.installed?.[p.key] && <em className="admin-warn"> (package not installed on the server)</em>}
              </label>
            ))}
          </fieldset>

          <div className="admin-cards">
            {saved.providers.map((p) => {
              const k = saved.keys[p.key];
              const result = tests[p.key];
              return (
                <section key={p.key} className={`admin-card${draft.provider === p.key ? ' active' : ''}`}>
                  <h3>{p.label}</h3>
                  <div className="field">
                    <label htmlFor={`admin_model_${p.key}`}>Model</label>
                    <input
                      id={`admin_model_${p.key}`}
                      className="field-input"
                      value={draft[MODEL_FIELD[p.key]]}
                      onChange={(e) => set(MODEL_FIELD[p.key], e.target.value)}
                      placeholder={p.defaultModel}
                      spellCheck={false}
                      autoComplete="off"
                      disabled={busy}
                    />
                  </div>

                  <div className="admin-key-state">
                    <KeyRound size={14} />
                    {!k.saved && <span>No API key saved.</span>}
                    {k.saved && k.readable && (
                      <span>Key saved{k.savedAt ? ` ${formatDateTime(k.savedAt)}` : ''}.</span>
                    )}
                    {k.saved && !k.readable && (
                      <span className="admin-warn">
                        A key is saved but can no longer be read (the server&rsquo;s secret key changed).
                        Paste it again.
                      </span>
                    )}
                    {k.saved && (
                      <button
                        type="button"
                        className="admin-link-danger"
                        onClick={() => removeKey(p.key)}
                        disabled={busy}
                      >
                        <Trash2 size={13} /> {removing === p.key ? 'Removing…' : 'Remove key'}
                      </button>
                    )}
                  </div>

                  <div className="field">
                    <label htmlFor={`admin_key_${p.key}`}>{k.saved ? 'Replace the key' : 'Paste the API key'}</label>
                    <input
                      id={`admin_key_${p.key}`}
                      className="field-input"
                      type="password"
                      value={draft[KEY_FIELD[p.key]]}
                      onChange={(e) => set(KEY_FIELD[p.key], e.target.value)}
                      placeholder={k.saved ? 'Leave empty to keep the saved key' : KEY_HINT[p.key]}
                      autoComplete="new-password"
                      spellCheck={false}
                      disabled={busy}
                    />
                  </div>

                  <div className="admin-test-row">
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => test(p.key)}
                      disabled={busy || testing !== null}
                      title={draft[KEY_FIELD[p.key]].trim()
                        ? 'Try the key typed above (not saved yet) with this model'
                        : 'Try the saved key with this model'}
                    >
                      <PlugZap size={14} /> {testing === p.key ? 'Testing…' : 'Test connection'}
                    </button>
                    {result && (
                      <span className={`admin-test ${result.ok ? 'is-ok' : 'is-bad'}`} role="status">
                        {result.ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />} {result.message}
                      </span>
                    )}
                  </div>
                </section>
              );
            })}
          </div>

          {access && (
            <section className="admin-card admin-access">
              <h3><EyeOff size={15} /> Software serial numbers</h3>
              <p className="admin-muted">
                Software serial numbers (licence keys) are shown as {access.mask || 'XXXX'} everywhere.
                The profiles ticked here get an eye button beside them to see one; each time it is used,
                it is recorded in the Activity Log.
              </p>
              <div className="admin-roles" role="group" aria-label="Profiles that can see software serial numbers">
                {access.choices.map((role) => {
                  const always = (access.alwaysAllowed || []).includes(role);
                  return (
                    <label key={role} className={`admin-provider${accessDraft.includes(role) || always ? ' active' : ''}`}
                      title={always ? 'A superadmin can always see them' : undefined}>
                      <input
                        type="checkbox"
                        checked={always || accessDraft.includes(role)}
                        disabled={always || savingAccess}
                        onChange={() => toggleRole(role)}
                      />
                      <span className="admin-role-name">{role}</span>
                    </label>
                  );
                })}
              </div>
              <div className="admin-test-row">
                <button type="button" className="btn-secondary" onClick={saveAccess}
                  disabled={savingAccess || !accessDirty}>
                  {savingAccess ? 'Saving…' : 'Save who can see them'}
                </button>
                {accessNote && (
                  <span className={`admin-test ${accessNote.ok ? 'is-ok' : 'is-bad'}`} role="status">
                    {accessNote.ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />} {accessNote.text}
                  </span>
                )}
              </div>
            </section>
          )}

          {saved.updatedBy && (
            <p className="admin-muted admin-foot-note">
              Last changed by {saved.updatedBy}{saved.updatedAt ? `, ${formatDateTime(saved.updatedAt)}` : ''}.
            </p>
          )}
        </div>

        <div className="modal-foot">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>Close</button>
          <button type="button" className="btn-primary" onClick={save} disabled={busy || !dirty}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AdminControlsModal;
