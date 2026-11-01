import { useMemo, useState } from 'react';
import { Layers, X } from 'lucide-react';
import { errorMessage } from '../api';
import { useAssets } from '../context/AssetsContext';
import { byKey } from '../lib/schema';
import DateInput from './DateInput';
import './BulkEditModal.css';

const BULK_KEYS = [
  'status', 'type', 'department', 'company',
  'user', 'email',
  'site', 'floor', 'location',
  'warrantyEnd', 'insuranceEnd', 'comments',
];

const BulkEditModal = ({ ids, onClose, onDone }) => {
  const { updateAssets, formOptionsFor } = useAssets();
  const [values, setValues] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const columns = useMemo(() => BULK_KEYS.map(byKey).filter(Boolean), []);

  const changes = useMemo(() => {
    const out = {};
    Object.entries(values).forEach(([key, value]) => {
      if (String(value ?? '').trim()) out[key] = String(value).trim();
    });
    return out;
  }, [values]);

  const fieldCount = Object.keys(changes).length;

  const handleSave = async () => {
    if (!fieldCount) {
      setError('Fill in at least one field. Empty boxes are left unchanged.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      onDone(await updateAssets(ids, changes));
    } catch (err) {
      setError(errorMessage(err, 'Could not apply the changes.'));
      setSaving(false);
    }
  };

  const renderControl = (col) => {
    const id = `bulk_${col.key}`;
    const value = values[col.key] ?? '';
    const onChange = (v) => setValues((prev) => ({ ...prev, [col.key]: v }));

    if (col.type === 'select') {
      return (
        <select id={id} className="field-input" value={value}
          onChange={(e) => onChange(e.target.value)}>
          <option value="">Leave unchanged</option>
          {formOptionsFor(col.key, value).map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
      );
    }

    if (col.type === 'textarea') {
      return (
        <textarea id={id} className="field-input" rows={2} value={value}
          placeholder="Leave unchanged"
          onChange={(e) => onChange(e.target.value)} />
      );
    }

    if (col.type === 'date') {
      return (
        <DateInput id={id} className="field-input" value={value}
          placeholder="dd-mm-yyyy (leave unchanged)" onChange={onChange} />
      );
    }

    return (
      <input
        id={id}
        className="field-input"
        type={col.type === 'email' ? 'email' : 'text'}
        value={value}
        placeholder="Leave unchanged"
        onChange={(e) => onChange(e.target.value)}
      />
    );
  };

  return (
    <div className="modal-overlay">
      <div className="modal bulk-edit-modal">
        <div className="modal-head">
          <h2><Layers size={16} /> Edit {ids.length.toLocaleString('en-IN')} assets</h2>
          <button type="button" className="modal-close" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          {error && <div className="banner banner-error">{error}</div>}
          <p className="bulk-edit-intro">
            Whatever you fill in is applied to all{' '}
            <strong>{ids.length.toLocaleString('en-IN')}</strong> selected assets.
            <strong> Anything left blank is not touched</strong> — this cannot clear a
            field. Deleted assets in the selection are skipped.
          </p>

          <div className="form-grid bulk-edit-grid">
            {columns.map((col) => (
              <div className={`field${col.type === 'textarea' ? ' field-wide' : ''}`} key={col.key}>
                <label htmlFor={`bulk_${col.key}`}>{col.label}</label>
                {renderControl(col)}
              </div>
            ))}
          </div>
        </div>

        <div className="modal-foot">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" onClick={handleSave}
            disabled={saving || !fieldCount}>
            {saving
              ? 'Applying…'
              : `Apply ${fieldCount || 'no'} change${fieldCount === 1 ? '' : 's'} to ${ids.length}`}
          </button>
        </div>
      </div>
    </div>
  );
};

export default BulkEditModal;
