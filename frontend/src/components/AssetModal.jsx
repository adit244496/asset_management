import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, History, X } from 'lucide-react';
import { errorMessage } from '../api';
import { useAssets } from '../context/AssetsContext';
import { ASSET } from '../lib/registers';
import { emptyAsset, validateAsset } from '../lib/schema';
import AssetForm from './AssetForm';
import AssetHistory from './AssetHistory';

const AssetModal = ({
  asset, onClose, sentBack = null, onSaved = null, onlyFields = null, fieldLabels = null,
  focusLink = false, highlightLink = false,
}) => {
  const { assets, updateAsset, register, meta } = useAssets();
  const [values, setValues] = useState(() => ({ ...emptyAsset(asset?.register || register), ...asset }));
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [pendingNotice, setPendingNotice] = useState('');
  const isAssets = register === ASSET;
  const frozen = asset?.pendingApproval;
  const [linked, setLinked] = useState(() => asset?.linkedPeripherals || []);
  const linkRef = useRef(null);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    if (!focusLink) return undefined;
    const timer = setTimeout(() => linkRef.current?.focus?.(), 60);
    return () => clearTimeout(timer);
  }, [focusLink]);

  const handleChange = (key, value) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  };

  const handleSave = async () => {
    const all = validateAsset(values, {
      register: assets, selfId: asset.id, registerKey: register, original: asset,
    });
    const found = onlyFields
      ? Object.fromEntries(Object.entries(all).filter(([key]) => onlyFields.includes(key)))
      : all;
    if (Object.keys(found).length) {
      setErrors(found);
      setError('Please fix the highlighted fields below.');
      return;
    }

    let toLink = linked;
    if (isAssets && !onlyFields && linkRef.current) {
      const flushed = await linkRef.current.flush();
      if (!flushed.ok) {
        setError('That peripheral could not be linked — see the message under '
          + 'Link Peripherals. Clear the box to save without it.');
        return;
      }
      toLink = flushed.items;
    }

    setSaving(true);
    setError('');
    try {
      const saved = await updateAsset(asset.id, onlyFields
        ? Object.fromEntries(onlyFields.map((key) => [key, values[key] ?? '']))
        : isAssets
          ? { ...values, linkedPeripheralIds: toLink.map((p) => p.id) }
          : values);
      if (saved?.approvalRequested) {
        setPendingNotice('This edit marks it sold, so it has been sent to the IT head for '
          + 'approval. Nothing has changed yet; the record is locked until they decide.');
        return;
      }
      onSaved?.(saved);
      onClose();
    } catch (err) {
      setError(errorMessage(err, 'Could not save changes.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal">
        <div className="modal-head">
          <h2>Edit {meta.label.replace(/s$/, '')}</h2>
          <button type="button" className="modal-close" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          {pendingNotice && <div className="banner banner-info">{pendingNotice}</div>}
          {sentBack && (
            <div className="banner banner-warning">
              <strong>Sent back{sentBack.by ? ` by ${sentBack.by}` : ''}:</strong> {sentBack.note || 'no reason given'}
              <br />
              Correct it below and press Save &amp; resubmit — it goes back to the verifiers.
            </div>
          )}
          {frozen && !pendingNotice && (
            <div className="banner banner-warning">
              Waiting for the IT head to approve its {frozen.kind === 'scrap' ? 'scrapping' : 'sale'}
              {' '}(asked by {frozen.requestedBy}). It cannot be changed until that is decided
              or withdrawn by a superadmin on Master Data &gt; Notifications.
            </div>
          )}
          {error && <div className="banner banner-error">{error}</div>}
          <AssetForm
            values={values}
            errors={errors}
            onChange={handleChange}
            idPrefix="edit"
            originalStatus={asset.status}
            linked={linked}
            onLinkChange={isAssets ? setLinked : null}
            linkDisabled={saving}
            linkRef={linkRef}
            linkHighlight={focusLink || highlightLink}
            onlyFields={onlyFields}
            fieldLabels={fieldLabels}
          />

          <div className="asset-history-section">
            <button
              type="button"
              className="asset-history-toggle"
              onClick={() => setShowHistory((open) => !open)}
              aria-expanded={showHistory}
            >
              {showHistory ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <History size={13} /> History
            </button>
            {showHistory && (
              <div className="asset-history-panel">
                <AssetHistory key={asset.id} assetId={asset.id} assetNumber={asset.assetId} />
              </div>
            )}
          </div>
        </div>

        <div className="modal-foot">
          {pendingNotice ? (
            <button type="button" className="btn-primary" onClick={onClose}>Close</button>
          ) : (
            <>
              <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
              <button type="button" className="btn-primary" onClick={handleSave}
                disabled={saving || Boolean(frozen)}>
                {saving ? 'Saving…' : sentBack ? 'Save & resubmit' : 'Save Changes'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default AssetModal;
