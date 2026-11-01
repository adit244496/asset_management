import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, Keyboard, ScanLine, SkipForward, X } from 'lucide-react';
import api, { errorMessage } from '../api';
import { useAssets } from '../context/AssetsContext';
import { SCAN_QUIET_MS, appendToBurst, isCompleteScan } from '../lib/scanDetect';
import { serialKey } from '../lib/serials';
import './ScanSerialsModal.css';

const EMPTY_BURST = { text: '', length: 0 };

const ScanSerialsModal = ({ queue, onClose, onFinished }) => {
  const { assets, refresh } = useAssets();
  const [index, setIndex] = useState(0);
  const [srl, setSrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [typed, setTyped] = useState(false);
  const [conflict, setConflict] = useState(null);
  const [saved, setSaved] = useState([]);
  const [skipped, setSkipped] = useState(0);
  const inputRef = useRef(null);

  const burstRef = useRef(EMPTY_BURST);
  const lastKeyAtRef = useRef(0);
  const quietTimerRef = useRef(null);
  const savingRef = useRef(false);
  const scannedHereRef = useRef(new Map());
  const commitRef = useRef(() => {});

  const current = queue[index] || null;
  const done = index >= queue.length;

  const bySerial = useMemo(() => {
    const map = new Map();
    assets.forEach((a) => {
      const key = serialKey(a.srl);
      if (key) map.set(key, a);
    });
    return map;
  }, [assets]);

  useEffect(() => {
    if (!done) inputRef.current?.focus();
  }, [index, done]);

  useEffect(() => () => clearTimeout(quietTimerRef.current), []);

  const resetBurst = () => {
    clearTimeout(quietTimerRef.current);
    burstRef.current = EMPTY_BURST;
  };

  const finish = () => {
    resetBurst();
    if (saved.length) refresh().catch(() => {  });
    onFinished({ saved: saved.length, skipped });
  };

  const advance = () => {
    resetBurst();
    setSrl('');
    setError('');
    setTyped(false);
    setConflict(null);
    setIndex((i) => i + 1);
  };

  const save = async (value) => {
    if (savingRef.current || !current || !value) return;

    const key = serialKey(value);
    const clash = scannedHereRef.current.get(key) || bySerial.get(key);
    if (clash && clash.id !== current.id) {
      setConflict(clash);
      return;
    }

    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      await api.patch(`/assets/${encodeURIComponent(current.id)}`, { srl: value });
      scannedHereRef.current.set(key, { ...current, srl: value });
      setSaved((prev) => [...prev, current.id]);
      advance();
    } catch (err) {
      setError(errorMessage(err, 'Could not save this serial number.'));
    } finally {
      savingRef.current = false;
      setSaving(false);
      inputRef.current?.focus();
    }
  };

  const commit = () => {
    clearTimeout(quietTimerRef.current);
    const burst = burstRef.current;
    burstRef.current = EMPTY_BURST;
    if (savingRef.current || !burst.length) return;

    const value = burst.text.trim();
    if (!isCompleteScan(burst.length) || !value) {
      setTyped(true);
      setSrl('');
      return;
    }

    setTyped(false);
    setSrl(value);
    save(value);
  };

  useEffect(() => { commitRef.current = commit; });

  const skip = () => {
    resetBurst();
    setSkipped((n) => n + 1);
    advance();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      onClose();
      return;
    }

    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      commit();
      return;
    }

    if (e.key.length !== 1 || e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;

    e.preventDefault();
    const now = Date.now();
    burstRef.current = appendToBurst(burstRef.current, e.key, now - lastKeyAtRef.current);
    lastKeyAtRef.current = now;

    if (conflict) setConflict(null);
    if (typed) setTyped(false);
    if (error) setError('');
    if (isCompleteScan(burstRef.current.length)) setSrl(burstRef.current.text);

    clearTimeout(quietTimerRef.current);
    quietTimerRef.current = setTimeout(() => commitRef.current(), SCAN_QUIET_MS);
  };

  const progress = queue.length ? Math.round((index / queue.length) * 100) : 0;

  return (
    <div className="modal-overlay">
      <div className="modal modal-narrow scan-modal">
        <div className="modal-head">
          <h2>
            <ScanLine size={16} /> Scan serial numbers
          </h2>
          <button type="button" className="modal-close" onClick={done ? finish : onClose} title="Close">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          {done ? (
            <div className="scan-done">
              <Check size={26} className="scan-done-icon" />
              <h3>Queue finished</h3>
              <p>
                {saved.length.toLocaleString('en-IN')} serial number(s) saved
                {skipped > 0 && `, ${skipped.toLocaleString('en-IN')} skipped`}.
              </p>
            </div>
          ) : (
            <>
              <div className="scan-progress">
                <div className="scan-progress-text">
                  Asset <strong>{index + 1}</strong> of {queue.length}
                  {saved.length > 0 && <span className="scan-progress-saved"> · {saved.length} saved</span>}
                </div>
                <div className="scan-progress-bar">
                  <div className="scan-progress-fill" style={{ width: `${progress}%` }} />
                </div>
              </div>

              <div className="scan-asset">
                <div className="scan-asset-id">{current.assetId}</div>
                <div className="scan-asset-name">{current.assetTag || current.model}</div>
                <dl className="scan-asset-meta">
                  <div><dt>Model</dt><dd>{current.model || '—'}</dd></div>
                  <div><dt>User</dt><dd>{current.user || '—'}</dd></div>
                  <div><dt>Site</dt><dd>{current.site || '—'}</dd></div>
                </dl>
                {current.srl && (
                  <div className="scan-existing">
                    Current Srl No. <strong>{current.srl}</strong> — scanning replaces it.
                  </div>
                )}
              </div>

              {conflict && (
                <div className="banner banner-error scan-conflict">
                  <AlertTriangle size={13} />
                  <span>
                    <strong>{srl.trim()}</strong> is already the Srl No. of{' '}
                    <strong>{conflict.assetId}</strong> ({conflict.assetTag || conflict.model})
                    {conflict.status === 'SCRAP' && ', which is deleted'}. A serial number
                    belongs to one device, so it can&rsquo;t be used twice — scan the right
                    barcode, or Skip this asset.
                  </span>
                </div>
              )}
              {typed && !conflict && (
                <div className="banner banner-warning scan-typed">
                  <Keyboard size={13} />
                  <span>
                    Serial numbers can only be scanned, not typed — they have to match
                    what is printed on the device. Use the barcode reader, or Skip this
                    asset.
                  </span>
                </div>
              )}
              {error && <div className="banner banner-error">{error}</div>}

              <div className="field scan-field">
                <label htmlFor="scanSrl">Srl No. — the only field this changes</label>
                <input
                  ref={inputRef}
                  id="scanSrl"
                  className="field-input scan-input"
                  type="text"
                  autoComplete="off"
                  readOnly
                  placeholder={saving ? 'Saving…' : 'Waiting for scan…'}
                  value={srl}
                  onKeyDown={handleKeyDown}
                  onPaste={(e) => { e.preventDefault(); setTyped(true); }}
                  onBlur={() => { if (!done) setTimeout(() => inputRef.current?.focus(), 0); }}
                />
                <div className="field-hint">
                  Scan the barcode — it saves and moves to the next asset on its own.
                  Nothing to click.
                </div>
              </div>
            </>
          )}
        </div>

        <div className="modal-foot">
          {done ? (
            <button type="button" className="btn-primary" onClick={finish}>Done</button>
          ) : (
            <>
              <button type="button" className="btn-secondary" onClick={finish}>
                Finish early
              </button>
              <button
                type="button"
                className="btn-secondary scan-skip"
                onMouseDown={(e) => e.preventDefault()}
                onClick={skip}
              >
                <SkipForward size={13} /> Skip
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ScanSerialsModal;
