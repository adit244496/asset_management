import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, History, X } from 'lucide-react';
import AssetHistory from './AssetHistory';
import StatusBadge from './StatusBadge';
import './MultiHistoryModal.css';

// Movement history of several records, one at a time, stepped with Previous / Next.
const MultiHistoryModal = ({ records, register, noun = 'record', onClose }) => {
  const [index, setIndex] = useState(0);
  const total = records.length;
  const record = records[Math.min(index, total - 1)];

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest?.('select, input, textarea')) return;
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1));
      if (e.key === 'ArrowRight') setIndex((i) => Math.min(total - 1, i + 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, total]);

  if (!record) return null;
  const label = (r) => [r.assetId, r.assetTag || r.model].filter(Boolean).join(' — ');

  return (
    <div
      className="modal-overlay multi-hist-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal multi-hist" role="dialog" aria-modal="true" aria-label="Movement history">
        <div className="modal-head">
          <h2 className="multi-hist-title"><History size={17} /> Movement history</h2>
          <button type="button" className="modal-close" onClick={onClose} title="Close" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="multi-hist-record">
          <div className="multi-hist-who">
            <span className="multi-hist-id">{record.assetId || '—'}</span>
            <span className="multi-hist-name">
              {[record.assetTag, record.model].filter(Boolean).join(' · ') || `This ${noun}`}
            </span>
          </div>
          {record.status && <StatusBadge status={record.status} />}
          <span className="multi-hist-pos">{(index + 1).toLocaleString('en-IN')} of {total.toLocaleString('en-IN')}</span>
        </div>

        <div className="modal-body multi-hist-body">
          <AssetHistory key={record.id} assetId={record.id} assetNumber={record.assetId} register={register} />
        </div>

        <div className="modal-foot multi-hist-foot">
          <button
            type="button"
            className="btn-secondary multi-hist-step"
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
            disabled={index === 0}
          >
            <ChevronLeft size={16} /> Previous
          </button>
          {total > 1 && (
            <select
              className="field-input multi-hist-jump"
              value={index}
              onChange={(e) => setIndex(Number(e.target.value))}
              aria-label={`Jump to a ${noun}`}
            >
              {records.map((r, i) => (
                <option key={r.id} value={i}>{`${i + 1}. ${label(r)}`}</option>
              ))}
            </select>
          )}
          <button
            type="button"
            className="btn-primary multi-hist-step"
            onClick={() => setIndex((i) => Math.min(total - 1, i + 1))}
            disabled={index >= total - 1}
          >
            Next <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default MultiHistoryModal;
