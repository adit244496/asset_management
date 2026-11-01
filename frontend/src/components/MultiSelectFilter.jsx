import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { placeDropdown } from '../lib/dropdownPlacement';
import { NOT_RECORDED, isNotRecorded } from '../lib/notRecorded';
import './MultiSelectFilter.css';

const MultiSelectFilter = ({ options, selected, onChange }) => {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const boxRef = useRef(null);
  const panelRef = useRef(null);

  const place = useCallback(() => {
    const anchor = boxRef.current;
    if (!anchor) return;
    setPos(placeDropdown(
      anchor.getBoundingClientRect(),
      { width: window.innerWidth, height: window.innerHeight },
      panelRef.current?.offsetWidth || 0,
    ));
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return undefined;
    }
    place();
    const reposition = () => place();
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return undefined;
    const onDocumentClick = (e) => {
      if (boxRef.current?.contains(e.target)) return;
      if (panelRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKeyDown = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDocumentClick);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocumentClick);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const toggleValue = (value) => {
    onChange(selected.includes(value)
      ? selected.filter((v) => v !== value)
      : [...selected, value]);
  };

  const panel = (
    <div
      className="multiselect-panel"
      ref={panelRef}
      style={pos
        ? {
          left: pos.left,
          top: pos.top,
          bottom: pos.bottom,
          minWidth: pos.minWidth,
          maxWidth: pos.maxWidth,
          maxHeight: pos.maxHeight,
        }
        : { left: 0, top: 0, visibility: 'hidden' }}
    >
      {options.length === 0 && <div className="multiselect-empty">No values yet</div>}
      {options.map((v) => (
        <label className="multiselect-option" key={v}>
          <input
            type="checkbox"
            checked={selected.includes(v)}
            onChange={() => toggleValue(v)}
          />
          {isNotRecorded(v)
            ? <span className="multiselect-empty-value">{NOT_RECORDED} not recorded</span>
            : v}
        </label>
      ))}
    </div>
  );

  return (
    <div className="multiselect" ref={boxRef}>
      <button
        type="button"
        className={`multiselect-btn${selected.length ? ' active' : ''}`}
        onClick={() => setOpen((v) => !v)}
      >
        {selected.length === 0 ? 'All' : `${selected.length} selected`}
      </button>

      {open && createPortal(panel, document.body)}
    </div>
  );
};

export default MultiSelectFilter;
