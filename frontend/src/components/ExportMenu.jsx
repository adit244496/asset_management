import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Download } from 'lucide-react';
import './ExportMenu.css';

const ExportMenu = ({ options, label = 'Export', disabled = false, busy = false }) => {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const choose = async (option) => {
    setOpen(false);
    await option.onSelect();
  };

  return (
    <div className="export-menu" ref={wrapRef}>
      <button
        type="button"
        className="btn-secondary export-menu-btn"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled || busy}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Download size={14} />
        {busy ? 'Preparing…' : label}
        <ChevronDown size={13} className="export-menu-caret" />
      </button>

      {open && (
        <div className="export-menu-pop" role="menu">
          {options.map((option) => (
            <button
              key={option.label}
              type="button"
              className="export-menu-item"
              role="menuitem"
              onClick={() => choose(option)}
            >
              <span className="export-menu-item-label">{option.label}</span>
              {option.hint && <span className="export-menu-item-hint">{option.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default ExportMenu;
