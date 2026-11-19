export function serialKey(value) {
  return (value ?? '').toString().trim().toLowerCase();
}

// Software keys reach the browser masked as XXXX (lib/serialAccess.js), so
// a masked value is never a real serial to compare: the server checks those
// against the actual keys.
const MASKED = 'xxxx';

export function findSerialOwner(assets, value, selfId = null) {
  const key = serialKey(value);
  if (!key || key === MASKED) return null;
  return (assets || []).find((a) => a && a.id !== selfId && !a.srlMasked
    && serialKey(a.srl) !== MASKED && serialKey(a.srl) === key) || null;
}

export function serialTakenMessage(owner) {
  if (!owner) return '';
  const name = owner.assetTag || owner.model;
  const who = name ? `${owner.assetId || 'another asset'} (${name})` : (owner.assetId || 'another asset');
  const tail = owner.availability === 'INACTIVE' && owner.status === 'SCRAP'
    ? ' That asset is deleted but still holds the serial.'
    : '';
  return `Already used by ${who}.${tail}`;
}
