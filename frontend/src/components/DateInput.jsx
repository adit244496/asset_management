import { useEffect, useRef, useState } from 'react';
import { Calendar } from 'lucide-react';
import { formatDate, parseDate } from '../lib/dates';
import './DateInput.css';

// A date box that shows and takes dd-mm-yyyy on every computer (the browser's
// own date box follows the machine's regional settings), with the browser's
// calendar behind the button. `value` and onChange are yyyy-mm-dd; text that
// is not a real date is passed on as typed, so the form can flag it.
const DateInput = ({
  value = '', onChange, id, className = '', title, placeholder = 'dd-mm-yyyy',
  disabled = false, ...rest
}) => {
  const [text, setText] = useState(formatDate(value));
  const picker = useRef(null);

  useEffect(() => {
    if (parseDate(text) !== (value || null) && !(value === '' && text === '')) {
      setText(formatDate(value));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const typed = (next) => {
    setText(next);
    const clean = next.trim();
    if (!clean) onChange('');
    else onChange(parseDate(clean) || clean);
  };

  const openPicker = () => {
    const el = picker.current;
    if (!el || disabled) return;
    try { el.showPicker(); } catch { el.focus(); el.click(); }
  };

  return (
    <span className={`date-input ${className}`.trim()}>
      <input
        {...rest}
        id={id}
        type="text"
        inputMode="numeric"
        className="date-input-text"
        value={text}
        placeholder={placeholder}
        title={title}
        disabled={disabled}
        maxLength={10}
        onChange={(e) => typed(e.target.value)}
        onBlur={() => { const iso = parseDate(text); if (iso) setText(formatDate(iso)); }}
      />
      <button type="button" className="date-input-btn" onClick={openPicker} disabled={disabled}
        tabIndex={-1} aria-label="Choose a date" title="Choose a date">
        <Calendar size={13} />
      </button>
      <input
        ref={picker}
        type="date"
        className="date-input-native"
        tabIndex={-1}
        aria-hidden="true"
        value={parseDate(text) || ''}
        onChange={(e) => { setText(formatDate(e.target.value)); onChange(e.target.value); }}
      />
    </span>
  );
};

export default DateInput;
