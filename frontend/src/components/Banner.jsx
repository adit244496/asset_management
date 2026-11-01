import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import './Banner.css';

const DISMISS_MS = 6000;

const Banner = ({ banner, onDismiss, autoDismissMs = DISMISS_MS }) => {
  const [paused, setPaused] = useState(false);

  const dismissRef = useRef(onDismiss);
  useEffect(() => { dismissRef.current = onDismiss; });

  const text = banner?.text;
  const kind = banner?.kind;
  const sticky = Boolean(banner?.sticky) || kind === 'error';

  useEffect(() => {
    if (!text || sticky || paused) return undefined;
    const timer = setTimeout(() => dismissRef.current?.(), autoDismissMs);
    return () => clearTimeout(timer);
  }, [banner, text, sticky, paused, autoDismissMs]);

  if (!text) return null;

  return (
    <div
      className={`banner banner-${kind} banner-dismissible`}
      role={kind === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <span className="banner-text">{text}</span>
      <button
        type="button"
        className="banner-close"
        onClick={() => onDismiss?.()}
        title="Dismiss"
        aria-label="Dismiss message"
      >
        <X size={14} />
      </button>
    </div>
  );
};

export default Banner;
