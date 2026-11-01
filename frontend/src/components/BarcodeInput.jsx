import { useEffect, useRef, useState } from 'react';
import { Check, ScanLine, X } from 'lucide-react';
import { isScanTerminator, nextBurstLength } from '../lib/scanDetect';
import './BarcodeInput.css';

const CONFIRM_MS = 2000;

const BarcodeInput = ({ id, value, onChange, invalid, placeholder }) => {
  const [armed, setArmed] = useState(false);
  const [justScanned, setJustScanned] = useState(false);
  const inputRef = useRef(null);
  const lastKeyAtRef = useRef(0);
  const burstRef = useRef(0);
  const confirmTimerRef = useRef(null);

  useEffect(() => () => clearTimeout(confirmTimerRef.current), []);

  const arm = () => {
    setArmed(true);
    burstRef.current = 0;
    inputRef.current?.focus();
    inputRef.current?.select();
  };

  const confirmScan = () => {
    burstRef.current = 0;
    setArmed(false);
    setJustScanned(true);
    clearTimeout(confirmTimerRef.current);
    confirmTimerRef.current = setTimeout(() => setJustScanned(false), CONFIRM_MS);
  };

  const handleKeyDown = (e) => {
    const now = Date.now();

    if (e.key === 'Enter' || e.key === 'Tab') {
      if (isScanTerminator({ armed, burstLength: burstRef.current })) {
        if (e.key === 'Enter') e.preventDefault();
        confirmScan();
      }
      return;
    }

    if (e.key.length === 1) {
      burstRef.current = nextBurstLength(burstRef.current, now - lastKeyAtRef.current);
      lastKeyAtRef.current = now;
    }
  };

  return (
    <div className={`barcode-input${armed ? ' armed' : ''}`}>
      <div className="barcode-input-row">
        <input
          ref={inputRef}
          id={id}
          className={`field-input${invalid ? ' has-error' : ''}`}
          type="text"
          value={value}
          placeholder={armed ? 'Waiting for scan…' : placeholder}
          autoComplete="off"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => setArmed(false)}
        />
        <button
          type="button"
          className={`icon-btn barcode-scan-btn${armed ? ' active' : ''}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => (armed ? setArmed(false) : arm())}
          title={armed ? 'Cancel scanning' : 'Scan with a barcode reader'}
          aria-pressed={armed}
        >
          {armed ? <X size={13} /> : <ScanLine size={13} />}
          <span>{armed ? 'Cancel' : 'Scan'}</span>
        </button>
      </div>

      {armed && (
        <div className="barcode-hint barcode-hint-armed">
          Ready &mdash; scan the barcode now.
        </div>
      )}
      {!armed && justScanned && (
        <div className="barcode-hint barcode-hint-ok">
          <Check size={11} /> Scanned
        </div>
      )}
    </div>
  );
};

export default BarcodeInput;
