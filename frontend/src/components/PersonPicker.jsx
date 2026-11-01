import { useId, useMemo, useState } from 'react';
import { personLabel } from '../lib/people';
import './PersonPicker.css';

const MAX_SHOWN = 50;

const norm = (s) => (s || '').toString().toLowerCase();

function matches(person, query) {
  const hay = [person.fullName, person.username, person.email, person.location].map(norm).join(' ');
  return query.split(/\s+/).filter(Boolean).every((word) => hay.includes(word));
}

const PersonPicker = ({
  id, offered = [], elsewhere = [], selected = null, onPick, disabled = false,
  placeholder = 'Type a name…', loading = false, invalid = false,
  text = null, onTextChange = null,
}) => {
  const freeText = typeof onTextChange === 'function';
  const listId = useId();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const q = norm(freeText ? text : query).trim();
  const groups = useMemo(() => {
    const first = (q ? offered.filter((p) => matches(p, q)) : offered).slice(0, MAX_SHOWN);
    const seen = new Set(first.map((p) => p.id));
    const rest = q
      ? elsewhere.filter((p) => !seen.has(p.id) && matches(p, q)).slice(0, MAX_SHOWN - first.length)
      : [];
    return { first, rest };
  }, [q, offered, elsewhere]);
  const items = [...groups.first, ...groups.rest];
  const total = (q ? offered.filter((p) => matches(p, q)).length : offered.length);

  const pick = (person) => {
    onPick(person);
    setQuery('');
    setEditing(false);
    setOpen(false);
    setActive(0);
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, Math.max(items.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      if (open && items[active]) {
        e.preventDefault();
        pick(items[active]);
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }
    }
  };

  const shown = freeText ? (text ?? '') : (editing ? query : (selected ? personLabel(selected) : query));

  const option = (p, i) => (
    <li
      key={p.id}
      id={`${listId}-${i}`}
      role="option"
      aria-selected={i === active}
      className={`picker-option${i === active ? ' active' : ''}${selected?.id === p.id ? ' chosen' : ''}`}
      onMouseDown={(e) => { e.preventDefault(); pick(p); }}
      onMouseEnter={() => setActive(i)}
    >
      <span className="picker-name">{p.fullName || p.username}</span>
      <span className="picker-meta">
        {[p.username, p.location || 'location not recorded', p.email].filter(Boolean).join(' · ')}
      </span>
    </li>
  );

  return (
    <div className="picker">
      <input
        id={id}
        className={`field-input${invalid ? ' has-error' : ''}`}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && items[active] ? `${listId}-${active}` : undefined}
        autoComplete="off"
        disabled={disabled}
        placeholder={loading ? 'Loading people…' : placeholder}
        value={shown}
        onFocus={(e) => {
          setOpen(true);
          setActive(0);
          if (freeText) return;
          setEditing(true);
          setQuery(selected ? (selected.fullName || selected.username) : query);
          e.target.select();
        }}
        onChange={(e) => {
          setOpen(true);
          setActive(0);
          if (freeText) {
            onTextChange(e.target.value);
            return;
          }
          setQuery(e.target.value);
          setEditing(true);
          if (selected) onPick(null);
        }}
        onBlur={() => { setOpen(false); setEditing(false); }}
        onKeyDown={onKeyDown}
      />
      {open && !disabled && !loading && (
        <ul className="picker-list" id={listId} role="listbox">
          {groups.first.map((p, i) => option(p, i))}
          {groups.rest.length > 0 && (
            <li className="picker-heading" role="presentation">At other locations</li>
          )}
          {groups.rest.map((p, i) => option(p, groups.first.length + i))}
          {!items.length && (
            <li className="picker-empty" role="presentation">
              {q ? (freeText ? 'Nobody in the directory matches — it will be saved as typed.' : 'Nobody matches that.')
                : 'Nobody to suggest here — type a name to search everyone.'}
            </li>
          )}
          {total > groups.first.length && (
            <li className="picker-more" role="presentation">
              Showing {groups.first.length} of {total} — keep typing to narrow it.
            </li>
          )}
        </ul>
      )}
    </div>
  );
};

export default PersonPicker;
