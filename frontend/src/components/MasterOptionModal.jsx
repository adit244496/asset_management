import { useState } from 'react';
import { X } from 'lucide-react';
import api, { errorMessage } from '../api';
import './UserModal.css';

const MasterOptionModal = ({ category, label, option, onClose, onSaved }) => {
  const isEdit = !!option;
  const [name, setName] = useState(option?.name || '');
  const [description, setDescription] = useState(option?.description || '');
  const [isActive, setIsActive] = useState(option ? !!option.isActive : true);
  const [sortOrder, setSortOrder] = useState(option ? String(option.sortOrder ?? 0) : '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

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

    setSaving(true);
    setError('');
    try {
      if (isEdit) {
        const res = await api.patch(
          `/masters/${encodeURIComponent(category)}/${encodeURIComponent(option.id)}`,
          { name: clean, description: description.trim(), isActive, sortOrder: order },
        );
        const moved = res.data?.assetsUpdated || 0;
        onSaved(moved
          ? `${label} renamed to "${clean}" — ${moved.toLocaleString('en-IN')} asset(s) updated to match.`
          : `${label} "${clean}" updated.`);
      } else {
        await api.post(`/masters/${encodeURIComponent(category)}`, {
          name: clean,
          description: description.trim(),
          isActive,
          sortOrder: order,
        });
        onSaved(`${label} "${clean}" added.`);
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
