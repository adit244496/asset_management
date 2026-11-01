import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, CameraOff, History, Pencil, QrCode, ScanLine, Search, X } from 'lucide-react';
import { errorMessage } from '../api';
import AssetDetail from '../components/AssetDetail';
import AssetModal from '../components/AssetModal';
import Banner from '../components/Banner';
import QrCodesModal from '../components/QrCodesModal';
import QrScanner from '../components/QrScanner';
import StatusBadge from '../components/StatusBadge';
import { useAssets } from '../context/AssetsContext';
import { useAuth } from '../context/AuthContext';
import { registerOf } from '../lib/registers';
import { cameraAvailability } from '../lib/qrDecode';
import { SCAN_QUIET_MS } from '../lib/scanDetect';
import './LookupPage.css';

const LOOKUP_DEBOUNCE_MS = Math.max(SCAN_QUIET_MS, 350);

const MATCH_LABELS = {
  assetId: 'matched on its Asset ID',
  sapId: 'matched on its SAP ID',
  srl: 'matched on its serial number',
  serviceTag: 'matched on its service tag',
  assetTag: 'matched on its computer name',
  assetTagPartial: 'partial match on the computer name',
};

const LookupPage = () => {
  const { lookupAsset } = useAssets();
  const { canEdit } = useAuth();
  const navigate = useNavigate();

  const [text, setText] = useState('');
  const [result, setResult] = useState(null);
  const [searching, setSearching] = useState(false);
  const [banner, setBanner] = useState(null);
  const [editing, setEditing] = useState(null);
  const [qrIds, setQrIds] = useState(null);
  const [camera, setCamera] = useState(false);

  const inputRef = useRef(null);
  const requestRef = useRef(0);

  const cameraCan = cameraAvailability();

  useEffect(() => { inputRef.current?.focus(); }, []);

  const run = useCallback((raw) => {
    const query = raw.trim();
    if (!query) {
      setResult(null);
      return;
    }
    const ticket = ++requestRef.current;
    setSearching(true);
    lookupAsset(query)
      .then((res) => {
        if (ticket === requestRef.current) setResult(res);
      })
      .catch((err) => {
        if (ticket === requestRef.current) {
          setBanner({ text: errorMessage(err, 'Could not search.'), kind: 'error' });
        }
      })
      .finally(() => {
        if (ticket === requestRef.current) setSearching(false);
      });
  }, [lookupAsset]);

  useEffect(() => {
    const timer = setTimeout(() => run(text), LOOKUP_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text, run]);

  const toggleCamera = () => {
    if (camera) { setCamera(false); return; }
    if (!cameraCan.ok) {
      setBanner({ text: cameraCan.detail, kind: 'error' });
      return;
    }
    setBanner(null);
    setCamera(true);
  };

  const handleScan = (decoded) => {
    setCamera(false);
    setText(decoded);
    inputRef.current?.focus();
  };

  const clear = () => {
    setText('');
    setResult(null);
    inputRef.current?.focus();
  };

  const items = result?.items || [];
  const one = items.length === 1 ? items[0] : null;
  const searched = Boolean(result?.query);

  return (
    <div className="page-scroll lookup-page">
      <div className="page-card">
        <div className="page-header">
          <h1><Search size={19} /> Find an Asset</h1>
        </div>

        <Banner banner={banner} onDismiss={() => setBanner(null)} />

      <div className="lookup-box">
        <ScanLine size={18} className="lookup-icon" />
        <textarea
          ref={inputRef}
          className="lookup-input"
          rows={1}
          placeholder="Scan or type&hellip;"
          value={text}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); run(text); }
            if (e.key === 'Escape') clear();
          }}
        />
        {text && (
          <button type="button" className="lookup-clear" onClick={clear} title="Clear">
            <X size={15} />
          </button>
        )}
        <button
          type="button"
          className={`btn-secondary lookup-camera${camera ? ' active' : ''}`}
          onClick={toggleCamera}
          title={cameraCan.ok ? 'Scan a QR label with this device\'s camera' : cameraCan.detail}
        >
          {camera ? <CameraOff size={14} /> : <Camera size={14} />}
          {camera ? 'Stop camera' : 'Scan with camera'}
        </button>
      </div>

      {camera && <QrScanner onResult={handleScan} onCancel={() => setCamera(false)} />}

      {searching && <div className="lookup-status">Searching&hellip;</div>}

      {!searching && searched && !items.length && (
        <div className="lookup-empty">
          <QrCode size={22} />
          <p>
            Nothing in either register matches <strong>{result.query}</strong>.
          </p>
          <p className="lookup-empty-note">
            Assets, peripherals and softwares are all searched, by ID, SAP ID, serial number,
            service tag and computer name. If this device is new, it has to be added in Data Entry
            first.
          </p>
        </div>
      )}

      {!searching && items.length > 1 && (
        <div className="lookup-many">
          <div className="lookup-many-head">
            {items.length} records match <strong>{result.query}</strong>
            {result.matchedBy === 'assetTagPartial' && ' (partial match on the name)'}
            {result.matchedBy === 'assetTag'
              && ' — computer names are not unique in this register'}
          </div>
          {items.map((a) => (
            <button type="button" className="lookup-match" key={a.id}
              onClick={() => setResult({ ...result, items: [a] })}>
              <span className="lookup-match-id">{a.assetId}</span>
              <span className="lookup-match-name">{a.assetTag || a.model}</span>
              <span className="lookup-match-meta">{a.model}</span>
              <span className="lookup-match-reg">{registerOf(a.register).label}</span>
              <StatusBadge status={a.status} />
            </button>
          ))}
        </div>
      )}

      {!searching && one && (
        <>
          <div className="lookup-matched">
            Found <strong>{one.assetId}</strong> in {registerOf(one.register).label}
            {' — '}{MATCH_LABELS[result.matchedBy] || 'matched'}
          </div>

          <div className="lookup-actions">
            {canEdit && (
              <button type="button" className="btn-secondary" onClick={() => setEditing(one)}>
                <Pencil size={14} /> Edit
              </button>
            )}
            <button type="button" className="btn-secondary"
              onClick={() => navigate(`/history/${encodeURIComponent(one.id)}`)}>
              <History size={14} /> History
            </button>
            <button type="button" className="btn-secondary" onClick={() => setQrIds([one.id])}>
              <QrCode size={14} /> QR label
            </button>
          </div>

          <AssetDetail asset={one} />
        </>
      )}

      {editing && <AssetModal asset={editing} onClose={() => { setEditing(null); run(text); }} />}
      {qrIds && <QrCodesModal ids={qrIds} onClose={() => setQrIds(null)} />}
      </div>
    </div>
  );
};

export default LookupPage;
