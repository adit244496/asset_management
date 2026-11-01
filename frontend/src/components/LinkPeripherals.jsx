import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Check, Link2, ScanLine, X } from 'lucide-react';
import { errorMessage } from '../api';
import { useAssets } from '../context/AssetsContext';
import {
  SCAN_QUIET_MS, isCompleteScan, isScanTerminator, nextBurstLength,
} from '../lib/scanDetect';
import './LinkPeripherals.css';

const CONFIRM_MS = 1800;

const GLARE_MS = 4000;

const LinkPeripherals = forwardRef(({ value = [], onChange, disabled = false, highlight = false }, ref) => {
  const { lookupAsset, meta } = useAssets();
  const [text, setText] = useState('');
  const [armed, setArmed] = useState(false);
  const [glaring, setGlaring] = useState(highlight);

  useEffect(() => {
    if (!glaring) return undefined;
    const timer = setTimeout(() => setGlaring(false), GLARE_MS);
    return () => clearTimeout(timer);
  }, [glaring]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [justAdded, setJustAdded] = useState(false);

  const inputRef = useRef(null);
  const lastKeyAtRef = useRef(0);
  const burstRef = useRef(0);
  const confirmTimerRef = useRef(null);
  const quietTimerRef = useRef(null);

  useEffect(() => () => {
    clearTimeout(confirmTimerRef.current);
    clearTimeout(quietTimerRef.current);
  }, []);

  const arm = () => {
    setArmed(true);
    burstRef.current = 0;
    inputRef.current?.focus();
  };

  const flash = () => {
    setJustAdded(true);
    clearTimeout(confirmTimerRef.current);
    confirmTimerRef.current = setTimeout(() => setJustAdded(false), CONFIRM_MS);
  };

  const resolve = async (raw) => {
    const query = (raw ?? '').trim();
    if (!query) return { ok: true, item: null };

    let res;
    try {
      res = await lookupAsset(query);
    } catch (err) {
      return { ok: false, kind: 'error', message: errorMessage(err, 'Could not look that up.') };
    }

    const all = res.items || [];
    const hits = all.filter((a) => a.register === 'peripheral');

    if (all.length && !hits.length) {
      return {
        ok: false,
        kind: 'error',
        message: `${all[0].assetId} is an asset, not a peripheral. `
          + 'Only peripherals can be linked to an asset.',
      };
    }
    if (!hits.length) {
      return {
        ok: false,
        kind: 'error',
        message: `Nothing in the peripheral register matches "${res.query || query}". `
          + 'It has to be registered as a peripheral before it can be linked.',
      };
    }
    if (hits.length > 1) {
      return {
        ok: false,
        kind: 'error',
        message: `${hits.length} peripherals match "${res.query || query}". `
          + 'Scan its label, or type its serial number or Peripheral ID.',
      };
    }
    return { ok: true, item: hits[0] };
  };

  const add = async (raw) => {
    clearTimeout(quietTimerRef.current);
    if (busy || !(raw ?? '').trim()) return;
    setBusy(true);
    setNote(null);
    try {
      const out = await resolve(raw);
      if (!out.ok) {
        setNote({ text: out.message, kind: out.kind });
        return;
      }
      if (value.some((p) => p.id === out.item.id)) {
        setNote({ text: `${label(out.item)} is already on this list.`, kind: 'info' });
        setText('');
        return;
      }
      onChange([...value, out.item]);
      setText('');
      flash();
      const on = out.item.linkedAssets || [];
      if (on.length) {
        const names = on.map((a) => a.assetId).filter(Boolean).join(', ') || 'another asset';
        setNote(out.item.isSharedType
          ? { text: `${label(out.item)} is also on ${names}. It is a shared type, so it `
              + 'stays there as well.', kind: 'info' }
          : { text: `${label(out.item)} is currently on ${names}. Saving will move it here.`,
              kind: 'warning' });
      }
    } finally {
      setBusy(false);
      setArmed(false);
      burstRef.current = 0;
      inputRef.current?.focus();
    }
  };

  const flush = async () => {
    const query = text.trim();
    if (!query) return { ok: true, items: value };

    setBusy(true);
    try {
      const out = await resolve(query);
      if (!out.ok) {
        setNote({ text: out.message, kind: out.kind });
        inputRef.current?.focus();
        return { ok: false, items: value };
      }
      setText('');
      if (value.some((p) => p.id === out.item.id)) return { ok: true, items: value };
      const items = [...value, out.item];
      onChange(items);
      return { ok: true, items };
    } finally {
      setBusy(false);
    }
  };

  useImperativeHandle(ref, () => ({
    flush,
    focus: () => {
      inputRef.current?.scrollIntoView({ block: 'center' });
      inputRef.current?.focus();
    },
  }));

  const scheduleAutoAdd = () => {
    clearTimeout(quietTimerRef.current);
    quietTimerRef.current = setTimeout(() => {
      burstRef.current = 0;
      add(inputRef.current?.value ?? '');
    }, SCAN_QUIET_MS);
  };

  const handleKeyDown = (e) => {
    const now = Date.now();
    const scanning = isScanTerminator({ armed, burstLength: burstRef.current });

    if (e.key === 'Enter' || e.key === 'Tab') {
      if (scanning) {
        scheduleAutoAdd();
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        add(e.currentTarget.value);
      }
      return;
    }

    if (e.key.length === 1) {
      burstRef.current = nextBurstLength(burstRef.current, now - lastKeyAtRef.current);
      lastKeyAtRef.current = now;
      if (armed || isCompleteScan(burstRef.current)) scheduleAutoAdd();
    }
  };

  const remove = (id) => {
    onChange(value.filter((p) => p.id !== id));
    setNote(null);
  };

  return (
    <div className={`link-per${armed ? ' armed' : ''}`}>
      <div className="link-per-row">
        <div className={`link-per-field${glaring ? ' is-glaring' : ''}`}>
          <textarea
            ref={inputRef}
            className="field-input link-per-input"
            rows={1}
            value={text}
            disabled={disabled}
            placeholder={armed
              ? 'Waiting for scan…'
              : 'Scan to add — or type a serial number / Peripheral ID and press Enter'}
            onChange={(e) => { setText(e.target.value); setGlaring(false); }}
            onKeyDown={handleKeyDown}
            onBlur={() => setArmed(false)}
            aria-label="Add a peripheral by scanning or typing its identifier"
          />
        </div>
        <button
          type="button"
          className={`icon-btn link-per-scan${armed ? ' active' : ''}`}
          disabled={disabled || busy}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => (armed ? setArmed(false) : arm())}
          title={armed ? 'Cancel scanning' : 'Scan with a reader or camera-less QR wedge'}
          aria-pressed={armed}
        >
          {armed ? <X size={13} /> : <ScanLine size={13} />}
          <span>{armed ? 'Cancel' : 'Scan'}</span>
        </button>
        <button
          type="button"
          className="btn-ghost link-per-add"
          disabled={disabled || busy || !text.trim()}
          onClick={() => add(text)}
        >
          {busy ? 'Finding…' : 'Add'}
        </button>
      </div>

      {armed && (
        <div className="link-per-hint link-per-hint-armed">
          Ready &mdash; scan the peripheral&apos;s label. It is added on its own; keep scanning
          for more.
        </div>
      )}
      {!armed && justAdded && !note && (
        <div className="link-per-hint link-per-hint-ok"><Check size={11} /> Added</div>
      )}
      {note && <div className={`link-per-hint link-per-hint-${note.kind}`}>{note.text}</div>}

      {value.length > 0 ? (
        <ul className="link-per-list">
          {value.map((p) => (
            <li className="link-per-chip" key={p.id}>
              <Link2 size={12} className="link-per-chip-icon" />
              <span className="link-per-chip-id">{label(p)}</span>
              <span className="link-per-chip-meta">
                {[p.type, p.model].filter(Boolean).join(' · ')}
              </span>
              <button
                type="button"
                className="link-per-chip-x"
                disabled={disabled}
                onClick={() => remove(p.id)}
                title={`Unlink ${label(p)}`}
                aria-label={`Unlink ${label(p)}`}
              >
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="link-per-empty">
          Nothing linked yet. Scan a mouse, keyboard, dock or headset to attach it to this
          {' '}{meta.one}.
        </div>
      )}
    </div>
  );
});

function label(p) {
  return (p.srl || '').trim() || p.assetId || '—';
}

LinkPeripherals.displayName = 'LinkPeripherals';

export default LinkPeripherals;
