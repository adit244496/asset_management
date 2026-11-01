const SEPARATORS = /[._\-@/\s]+/g;

export function fold(value) {
  return (value ?? '').toString().toLowerCase().replace(SEPARATORS, ' ').trim();
}

export function haystackOf(...values) {
  return values.map(fold).filter(Boolean).join(' ');
}

export function searchTerms(query) {
  const folded = fold(query);
  return folded ? folded.split(' ') : [];
}

export function matchesAll(haystack, terms) {
  return terms.every((term) => haystack.includes(term));
}

export function filterBy(rows, query, toHaystack) {
  const terms = searchTerms(query);
  if (!terms.length) return rows || [];
  return (rows || []).filter((row) => matchesAll(toHaystack(row), terms));
}
