import { useState } from 'react';
import { X } from 'lucide-react';
import api, { errorMessage } from '../api';
import './UserModal.css';

// typeView (Type only): the list it is added to -- { key: 'asset' | 'peripheral', label, other }.
const MasterOptionModal = ({ category, label, option, onClose, onSaved, typeView = null }) => {
  const isEdit = !!option;
  const [name, setName] = useState(option?.name || '');
  const [description, setDescription] = useState(option?.description || '');
  const [isActive, setIsActive] = useState(option ? !!option.isActive : true);
  const [sortOrder, setSortOrder] = useState(option ? String(option.sortOrder ?? 0) : '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  // Types only: the abbreviation that starts new IDs (LAP -> LAP_00001).
  const hasCode = category === 'type';
  const [code, setCode] = useState(option?.code || '');
  const cleanCode = code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const recoding = isEdit && option?.code && cleanCode && cleanCode !== option.code;
  // Types only: added to the list it was opened from; optionally the other too.
  const [alsoOther, setAlsoOther] = useState(false);
  const usedFor = alsoOther ? 'both' : (typeView?.key || 'both');

  const inUse = option?.inUse || 0;
  const renaming = isEdit && name.trim() && name.trim() !== option.name;

  const handleSave = async () => {
    const clean = name.trim();
    if (!clean) {
      setError(`${label} name is required.`);
      return;
    }

    const order = sortOrder.trim() === '' ? undefined : Number(sortOrder);
    if (order !== undefined && !Number.isFinite(order)) {
      setError('Display order must be a number.');
      return;
    }
    if (hasCode && isEdit && option?.code && !cleanCode) {
      setError('The abbreviation cannot be blank — new IDs of this type are built from it.');
      return;
    }
    if (hasCode && cleanCode && !/^[A-Z][A-Z0-9]{2}$/.test(cleanCode)) {
      setError('The abbreviation must be exactly 3 letters or digits, starting with a letter (e.g. LAP, HDD, DE1).');
      return;
    }
    const codePart = {
      ...(hasCode && (cleanCode || !isEdit) ? { code: cleanCode } : {}),
      ...(hasCode ? { usedFor } : {}),
    };

    setSaving(true);
    setError('');
    try {
      if (isEdit) {
        const res = await api.patch(
          `/masters/${encodeURIComponent(category)}/${encodeURIComponent(option.id)}`,
          { name: clean, description: description.trim(), isActive, sortOrder: order, ...codePart },
        );
        const moved = res.data?.assetsUpdated || 0;
        onSaved(moved
          ? `${label} renamed to "${clean}" — ${moved.toLocaleString('en-IN')} asset(s) updated to match.`
          : `${label} "${clean}" updated.`);
      } else {
        const res = await api.post(`/masters/${encodeURIComponent(category)}`, {
          name: clean,
          description: description.trim(),
          isActive,
          sortOrder: order,
          ...codePart,
        });
        onSaved(`${label} "${clean}" added`
          + (res.data?.code ? ` — new IDs of this type: ${res.data.code}_00001, ${res.data.code}_00002 …` : '')
          + '.');
      }
    } catch (err) {
      setError(errorMessage(err, isEdit ? `Could not update this ${label}.` : `Could not add this ${label}.`));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal modal-narrow">
        <div className="modal-head">
          <h2>{isEdit ? `Edit ${label}` : `New ${label}`}</h2>
          <button type="button" className="modal-close" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          {error && <div className="banner banner-error">{error}</div>}

          <div className="user-form-grid">
            <div className="field">
              <label htmlFor="masterName">{label} *</label>
              <input
                id="masterName"
                className="field-input"
                type="text"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSave(); } }}
              />
              <div className="field-hint">
                Stored on the asset exactly as typed, so it also appears this way in exports.
              </div>
            </div>

            {renaming && inUse > 0 && (
              <div className="banner banner-info">
                {inUse.toLocaleString('en-IN')} asset(s) currently use &ldquo;{option.name}&rdquo; and will be
                updated to &ldquo;{name.trim()}&rdquo; when you save.
              </div>
            )}

            {hasCode && (
              <div className="field">
                <label htmlFor="masterCode">Abbreviation{isEdit && option?.code ? ' *' : ''}</label>
                <input
                  id="masterCode"
                  className="field-input serial-mono"
                  type="text"
                  maxLength={3}
                  value={code}
                  placeholder={isEdit ? '' : 'Left blank: first 3 letters (DES, then DE1 …)'}
                  onChange={(e) => setCode(e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase())}
                />
                <div className="field-hint">
                  Starts the ID of every new asset or peripheral of this type
                  {cleanCode ? <> &mdash; <strong>{cleanCode}_00001</strong>, {cleanCode}_00002 &hellip;</> : null}.
                  {' '}Exactly 3 letters or digits; each type needs its own.
                </div>
              </div>
            )}

            {hasCode && typeView && (
              <div className="field">
                <label className="user-must-change" htmlFor="masterAlsoOther">
                  <input
                    id="masterAlsoOther"
                    type="checkbox"
                    checked={alsoOther}
                    onChange={(e) => setAlsoOther(e.target.checked)}
                  />
                  <span>Also offer it for {typeView.other}</span>
                </label>
                <div className="field-hint">
                  Added to the {typeView.label} list, so Data Entry for {typeView.label} offers it
                  {alsoOther ? <>, and for {typeView.other} too</> : null}.
                </div>
              </div>
            )}

            {hasCode && !isEdit && (
              <div className="banner banner-warning">
                Check the name and abbreviation: a type cannot be edited once it is added. To
                change it later it has to be deleted and added again.
              </div>
            )}

            {recoding && (
              <div className="banner banner-info">
                New records of this type will be numbered {cleanCode}_&hellip;. IDs already given
                ({option.code}_&hellip;) stay as they are.
              </div>
            )}

            <div className="field">
              <label htmlFor="masterDescription">Description</label>
              <input
                id="masterDescription"
                className="field-input"
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
              <div className="field-hint">
                Optional note for admins &mdash; shown on this screen only, never on an asset.
              </div>
            </div>

            <div className="field">
              <label htmlFor="masterSortOrder">Display order</label>
              <input
                id="masterSortOrder"
                className="field-input"
                type="number"
                value={sortOrder}
                placeholder={isEdit ? '' : 'Added at the end of the list'}
                onChange={(e) => setSortOrder(e.target.value)}
              />
              <div className="field-hint">
                Low numbers come first in the dropdown; equal numbers fall back to alphabetical.
              </div>
            </div>

            <div className="field">
              <label htmlFor="masterActive">Availability</label>
              <select
                id="masterActive"
                className="field-input"
                value={String(isActive)}
                onChange={(e) => setIsActive(e.target.value === 'true')}
              >
                <option value="true">Active &mdash; offered in the asset form</option>
                <option value="false">Retired &mdash; hidden from the asset form</option>
              </select>
              <div className="field-hint">
                Retiring a value leaves existing assets untouched; it only stops the value
                being picked for new ones.
              </div>
            </div>
          </div>
        </div>

        <div className="modal-foot">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : (isEdit ? 'Save Changes' : `Add ${label}`)}
          </button>
        </div>
      </div>
    </div>
  );
};

export default MasterOptionModal;
