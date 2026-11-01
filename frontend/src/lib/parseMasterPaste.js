export const NAME_MAX = 150;
export const DESCRIPTION_MAX = 255;

export function classifyMasterEntries(entries, existingNames = []) {
  const existing = new Map();
  existingNames.forEach((n) => {
    const clean = String(n ?? '').trim();
    if (clean) existing.set(clean.toLowerCase(), clean);
  });

  const seen = new Map();
  const rows = [];

  (entries || []).forEach((entry) => {
    const name = String(entry?.name ?? '').trim();
    if (!name) return;
    const description = String(entry?.description ?? '').trim();

    let state = 'new';
    let reason = '';

    if (name.length > NAME_MAX) {
      state = 'invalid';
      reason = `longer than ${NAME_MAX} characters`;
    } else if (description.length > DESCRIPTION_MAX) {
      state = 'invalid';
      reason = `its description is longer than ${DESCRIPTION_MAX} characters`;
    } else {
      const key = name.toLowerCase();
      if (existing.has(key)) {
        state = 'exists';
        reason = `already in this list as "${existing.get(key)}"`;
      } else if (seen.has(key)) {
        state = 'duplicate';
        reason = `repeated (already listed above as "${seen.get(key)}")`;
      } else {
        seen.set(key, name);
      }
    }

    rows.push({ name, description, state, reason });
  });

  const count = (s) => rows.filter((r) => r.state === s).length;
  return {
    rows,
    total: rows.length,
    newCount: count('new'),
    existsCount: count('exists'),
    duplicateCount: count('duplicate'),
    invalidCount: count('invalid'),
  };
}

export function parseMasterPaste(text, existingNames = []) {
  const entries = String(text ?? '').split(/\r?\n/).map((line) => {
    const parts = line.split(/\t|\s*\|\s*/);
    return { name: (parts[0] || '').trim(), description: parts.slice(1).join(' ').trim() };
  })
    .filter((e) => e.name);

  return classifyMasterEntries(entries, existingNames);
}
