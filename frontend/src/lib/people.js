export function sameLocation(a, b) {
  return (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();
}

export function splitByLocation(people, location) {
  const active = (people || []).filter((p) => p && p.isActive);
  if (!(location || '').trim()) {
    return { here: [], unknown: active, elsewhere: [] };
  }
  return {
    here: active.filter((p) => p.location && sameLocation(p.location, location)),
    unknown: active.filter((p) => !p.location),
    elsewhere: active.filter((p) => p.location && !sameLocation(p.location, location)),
  };
}

export function describeSplit({ here, unknown }, location) {
  if (!(location || '').trim()) return 'Choose a location to narrow this list.';
  const head = here.length === 0
    ? `Nobody is recorded at ${location}`
    : `${here.length} ${here.length === 1 ? 'person is' : 'people are'} recorded at ${location}`;
  const tail = unknown.length > 0
    ? `, and ${unknown.length} with no location on file`
    : '';
  return `${head}${tail}.`;
}

export function matchesByName(people, name) {
  const wanted = (name || '').trim().toLowerCase();
  if (!wanted) return [];
  return (people || []).filter(
    (p) => (p.fullName || '').trim().toLowerCase() === wanted,
  );
}

export function findByName(people, name) {
  const found = matchesByName(people, name);
  return found.length === 1 ? found[0] : null;
}

export function personLabel(person) {
  const name = person.fullName || person.username;
  return `${name} — ${person.location || 'location not recorded'}`;
}
