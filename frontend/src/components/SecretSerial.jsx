import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { errorMessage } from '../api';
import { isSerialMask, revealSerial, useSerialAccess } from '../lib/serialAccess';
import './SecretSerial.css';

// A Serial Number as shown in lists and on records. For a software the server
// sends it masked (XXXX); a profile allowed under Admin controls gets an eye
// button to see it, and again to hide it. Anything else is shown as it is.
const SecretSerial = ({ record, className = 'serial-mono' }) => {
  const canReveal = useSerialAccess();
  const [shown, setShown] = useState(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  // Hide it again if the record changes, or if this profile loses the right.
  const [seenVersion, setSeenVersion] = useState(record?.updatedAt);
  if (record?.updatedAt !== seenVersion) {
    setSeenVersion(record?.updatedAt);
    setShown(null);
  }
  if (!canReveal && shown !== null) setShown(null);
  const value = record?.srl;
  const masked = record?.register === 'software' && (record?.srlMasked || isSerialMask(value));

  if (!masked) return <span className={className}>{value}</span>;

  const toggle = async (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (shown !== null) { setShown(null); return; }
    setBusy(true);
    setProblem('');
    try {
      setShown(await revealSerial(record.id));
    } catch (err) {
      setProblem(errorMessage(err, 'Could not show the serial number.'));
    } finally {
      setBusy(false);
    }
  };
  const stop = (e) => e.stopPropagation();

  return (
    <span className="secret-serial" onClick={stop} onKeyDown={stop} onPointerDown={stop}>
      <span className={`${className}${shown === null ? ' secret-serial-mask' : ''}`}
        title={shown === null ? 'Serial number hidden' : undefined}>
        {shown === null ? value : shown}
      </span>
      {canReveal && (
        <button
          type="button"
          className="secret-serial-eye"
          onClick={toggle}
          disabled={busy}
          title={shown === null ? 'Show the serial number (recorded in the Activity Log)' : 'Hide it again'}
          aria-label={shown === null ? 'Show the serial number' : 'Hide the serial number'}
        >
          {shown === null ? <Eye size={13} /> : <EyeOff size={13} />}
        </button>
      )}
      {problem && <span className="secret-serial-problem" role="alert">{problem}</span>}
    </span>
  );
};

export default SecretSerial;
