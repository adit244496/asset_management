export const UNSPECIFIED_LABEL = 'Unspecified';

export function optionLabel(value) {
  return (value ?? '').toString().trim() || UNSPECIFIED_LABEL;
}

export function matchesOption(value, filter) {
  if (!filter) return true;
  const clean = (value ?? '').toString().trim();
  if (filter === UNSPECIFIED_LABEL) {
    return clean === '' || clean === UNSPECIFIED_LABEL;
  }
  return clean === filter;
}

export function sortFilterOptions(labels) {
  const real = (labels || []).filter((l) => l !== UNSPECIFIED_LABEL).sort();
  return (labels || []).includes(UNSPECIFIED_LABEL) ? [...real, UNSPECIFIED_LABEL] : real;
}
