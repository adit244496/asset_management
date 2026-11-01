import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Printer, QrCode, X } from 'lucide-react';
import api, { errorMessage } from '../api';
import { useAssets } from '../context/AssetsContext';
import { pathOf, registerOf } from '../lib/registers';
import './QrCodesModal.css';

const QrLabelText = ({ item }) => (
  <div className="qr-label-text">
    <span className="qr-label-id">{item.assetId || ''}</span>
    <span className="qr-label-srl">{item.srl || ' '}</span>
  </div>
);

const QrCodesModal = ({ ids, onClose, register = null }) => {
  const { assetQrCodes, meta: shownMeta } = useAssets();
  const meta = register ? registerOf(register) : shownMeta;
  const [items, setItems] = useState(null);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState('');
  const [notFound, setNotFound] = useState(0);

  const fetchCodes = useCallback((list) => (register
    ? api.post(`/${pathOf(register)}/qr`, { ids: list }).then((res) => res.data)
    : assetQrCodes(list)), [register, assetQrCodes]);

  useEffect(() => {
    let live = true;
    fetchCodes(ids)
      .then((res) => {
        if (!live) return;
        setItems(res.items || []);
        setNotFound(res.notFound || 0);
      })
      .catch((err) => {
        if (live) setError(errorMessage(err, 'Could not build the QR codes.'));
      });
    return () => { live = false; };
  }, [ids, fetchCodes]);

  const total = items?.length || 0;
  const current = items?.[index] || null;

  const step = useCallback((delta) => {
    setIndex((i) => Math.min(Math.max(i + delta, 0), Math.max(total - 1, 0)));
  }, [total]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') step(1);
      if (e.key === 'ArrowLeft') step(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, step]);

  return (
    <div className="modal-overlay qr-overlay">
      <div className="modal qr-modal">
        <div className="modal-head">
          <h2><QrCode size={16} /> {meta.label.replace(/s$/, '')} QR labels</h2>
          <button type="button" className="modal-close" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          {error && <div className="banner banner-error">{error}</div>}
          {notFound > 0 && (
            <div className="banner banner-warning">
              {notFound} selected {meta.one}(s) are no longer in the register and have no label.
            </div>
          )}

          {!items && !error && <div className="qr-loading">Building codes&hellip;</div>}

          {current && (
            <>
              <div className="qr-counter">
                Label <strong>{index + 1}</strong> of {total}
              </div>

              <div className="qr-label qr-label-preview">
                <img className="qr-image" src={current.svg} alt={`QR code for ${current.assetId}`} />
                <QrLabelText item={current} />
              </div>

              <div className="qr-caption">
                <span className="qr-caption-name">{current.model || current.assetTag}</span>
                {current.serviceTag && <span className="qr-caption-line">Tag {current.serviceTag}</span>}
              </div>

              <details className="qr-payload">
                <summary>What this code says when scanned</summary>
                <pre>{current.payload}</pre>
              </details>
            </>
          )}
        </div>

        <div className="modal-foot qr-foot">
          <button type="button" className="btn-secondary" onClick={() => step(-1)}
            disabled={index <= 0}>
            <ChevronLeft size={14} /> Previous
          </button>
          <button type="button" className="btn-secondary" onClick={() => step(1)}
            disabled={index >= total - 1}>
            Next <ChevronRight size={14} />
          </button>
          <button type="button" className="btn-primary qr-print" onClick={() => window.print()}
            disabled={!total}>
            <Printer size={14} /> Print all {total || ''}
          </button>
        </div>
      </div>

      <div className="qr-print-sheet" aria-hidden="true">
        {(items || []).map((it) => (
          <div className="qr-label" key={it.assetPk}>
            <img className="qr-image" src={it.svg} alt="" />
            <QrLabelText item={it} />
          </div>
        ))}
      </div>
    </div>
  );
};

export default QrCodesModal;
