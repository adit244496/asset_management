import { useEffect, useMemo, useRef, useState } from 'react';
import api from '../api';
import { useAssets } from '../context/AssetsContext';
import {
  describeSplit, findByName, matchesByName, sameLocation, splitByLocation,
} from '../lib/people';
import PersonPicker from './PersonPicker';

const AssignedUserField = ({
  id, value, email, location, invalid, onChange, onEmailChange, onLocationChange,
  onFloorChange = null, floor = '',
}) => {
  const { assets: registerItems } = useAssets();
  const [people, setPeople] = useState(null);
  const [showEveryone, setShowEveryone] = useState(false);
  const filledRef = useRef('');

  useEffect(() => {
    let cancelled = false;
    api.get('/users')
      .then((res) => { if (!cancelled) setPeople(res.data || []); })
      .catch(() => { if (!cancelled) setPeople([]); });
    return () => { cancelled = true; };
  }, []);

  const split = useMemo(() => splitByLocation(people, location), [people, location]);
  const { here, unknown, elsewhere } = split;

  const offered = useMemo(
    () => (showEveryone ? [...here, ...unknown, ...elsewhere] : [...here, ...unknown]),
    [showEveryone, here, unknown, elsewhere],
  );

  const matches = matchesByName(people, value);
  const resolved = findByName(people, value);
  const ambiguous = matches.length > 1;

  const pickPerson = (person) => {
    if (!person) return;
    onChange(person.fullName || person.username);
    fill(person);
  };

  const fill = (person) => {
    if (onEmailChange) {
      const next = person.email || '';
      onEmailChange(next);
      filledRef.current = next;
    }
    if (!person.location) return;
    if (onLocationChange) onLocationChange(person.location);
    if (!onFloorChange) return;
    const who = (person.fullName || '').trim().toLowerCase();
    const theirs = (registerItems || [])
      .filter((a) => !a.isDeleted && a.floor && (a.user || '').trim().toLowerCase() === who
        && sameLocation(a.location, person.location))
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    if (theirs.length) onFloorChange(theirs[0].floor);
    else if (floor && !sameLocation(location, person.location)) onFloorChange('');
  };

  const handleInput = (typed) => {
    onChange(typed);

    const person = findByName(people, typed);
    if (person) {
      fill(person);
      return;
    }

    if (!onEmailChange) return;

    if (filledRef.current && email === filledRef.current) {
      onEmailChange('');
      filledRef.current = '';
    }
  };

  return (
    <>
      <PersonPicker
        id={id}
        offered={offered}
        elsewhere={showEveryone ? [] : elsewhere}
        selected={resolved}
        onPick={pickPerson}
        text={value ?? ''}
        onTextChange={handleInput}
        invalid={invalid}
        loading={people === null}
        placeholder="Type a name to find them, or anything else to save as typed"
      />

      <p className="field-hint">
        {people === null ? 'Loading people…' : describeSplit(split, location)}
        {people !== null && (location || '').trim() && elsewhere.length > 0 && (
          <>
            {' '}
            <button
              type="button"
              className="linklike"
              onClick={() => setShowEveryone((v) => !v)}
            >
              {showEveryone
                ? 'Suggest only people here'
                : `Also suggest everyone else (${elsewhere.length})`}
            </button>
          </>
        )}
        {people !== null && (value || '').trim() && !matches.length && (
          <> Not in the directory &mdash; saved as typed.</>
        )}
        {ambiguous && (
          <> {matches.length} accounts share this name, so Email ID and Location
            were not filled in &mdash; enter them yourself.</>
        )}
        {resolved && (
          <> Email ID{resolved.location ? ' and Location' : ''} filled in from{' '}
            {resolved.fullName || resolved.username}&rsquo;s record.</>
        )}
        {resolved && !resolved.location && (
          <> They have no location on file, so Location was left as it is.</>
        )}
      </p>
    </>
  );
};

export default AssignedUserField;
