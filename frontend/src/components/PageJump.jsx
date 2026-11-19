import { useEffect, useRef, useState } from 'react';
import './PageJump.css';

const GO_AFTER_MS = 500;
// Keys that move the caret or edit -- everything else that is not a digit is refused.
const EDIT_KEYS = new Set([
  'Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Tab', 'Enter', 'Escape',
]);

/* "Page [ 3 ] of 12": type a page number and the list goes there by itself
   (half a second after the last key, or straight away on Enter). Digits only,
   and never more than the last page -- a bigger number becomes the last page.
   `page` and `total` count from 1. */
const PageJump = ({ page, total, onGo, disabled = false, className = '' }) => {
  const [draft, setDraft] = useState(null); // what is typed; null = show the current page
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  const go = (value) => {
    clearTimeout(timer.current);
    const n = Number(value);
    if (Number.isInteger(n) && n >= 1 && n <= total && n !== page) onGo(n);
    setDraft(null);
  };

  const onChange = (e) => {
    let digits = e.target.value.replace(/\D/g, '').replace(/^0+/, '');
    if (digits && Number(digits) > total) digits = String(total);
    setDraft(digits);
    clearTimeout(timer.current);
    if (digits) timer.current = setTimeout(() => go(digits), GO_AFTER_MS);
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      go(draft ?? page);
      return;
    }
    if (e.key === 'Escape') {
      clearTimeout(timer.current);
      setDraft(null);
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey || EDIT_KEYS.has(e.key)) return;
    if (!/^\d$/.test(e.key)) e.preventDefault();
  };

  const shown = draft ?? String(page);
  const width = `${Math.max(2, String(total).length) + 1.6}ch`;

  return (
    <span className={`page-jump ${className}`.trim()}>
      Page
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        className="page-jump-input"
        style={{ width }}
        value={shown}
        disabled={disabled || total <= 1}
        aria-label={`Go to page (1 to ${total})`}
        title={`Type a page number from 1 to ${total}`}
        onChange={onChange}
        onKeyDown={onKeyDown}
        onFocus={(e) => e.target.select()}
        onBlur={() => (draft ? go(draft) : setDraft(null))}
      />
      of {total.toLocaleString('en-IN')}
    </span>
  );
};

export default PageJump;
