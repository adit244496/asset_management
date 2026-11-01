const clean = (v) => String(v ?? '').trim().toUpperCase();

function isCode(status, code) {
  const s = clean(status);
  if (s === code) return true;
  return s.startsWith(`${code} -`) || s.startsWith(`${code}-`) || s.startsWith(`${code} `);
}

export function isScrapped(status) {
  return clean(status) === 'SCRAP';
}

export function isInUse(status) {
  const s = clean(status);
  if (!s) return false;
  return isCode(s, 'A') || s.includes('IN USE') || s.includes('IN-USE') || s === 'ACTIVE';
}

export function isInStock(status) {
  const s = clean(status);
  if (!s) return false;
  return isCode(s, 'C') || s.includes('STOCK');
}

export function isLaterAdded(status) {
  const s = clean(status);
  if (!s) return false;
  return s.includes('LATER ADDED') || s.includes('LATER-ADDED');
}

export function isSoldOrDisposed(status, site) {
  const s = clean(status);
  if (isCode(s, 'D') || s.includes('SOLD') || s.includes('DISPOS') || s.includes('SCRAP')) return true;
  return clean(site) === 'SOLD';
}
