const clean = (value) => (value ?? '').toString().trim();

export function findUnknownMasters(rows, known, keys, labelFor = (k) => k) {
  const out = [];
  keys.forEach((key) => {
    const have = new Set((known[key] || []).map((v) => clean(v).toLowerCase()));
    const seen = new Map();
    (rows || []).forEach((row) => {
      const value = clean(row?.[key]);
      if (!value || have.has(value.toLowerCase())) return;
      if (!seen.has(value.toLowerCase())) seen.set(value.toLowerCase(), value);
    });
    if (seen.size) {
      out.push({
        key,
        label: labelFor(key),
        values: [...seen.values()].sort((a, b) => a.localeCompare(b)),
      });
    }
  });
  return out;
}

export function rowsAffected(rows, unknown) {
  if (!unknown.length) return 0;
  const bad = new Map(unknown.map((u) => [
    u.key, new Set(u.values.map((v) => v.toLowerCase())),
  ]));
  return (rows || []).filter((row) => (
    [...bad.entries()].some(([key, values]) => values.has(clean(row?.[key]).toLowerCase()))
  )).length;
}

export function describeUnknown(unknown) {
  const parts = unknown.map((u) => {
    const n = u.values.length;
    const label = u.label.toLowerCase();
    const plural = label.endsWith('y') ? `${label.slice(0, -1)}ies` : `${label}s`;
    return `${n} ${n === 1 ? label : plural}`;
  });
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
