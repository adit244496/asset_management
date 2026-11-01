export const VERIFIED = 'verified';
export const PENDING = 'pending';
export const REJECTED = 'rejected';

export const STATE_LABELS = {
  [PENDING]: 'Waiting',
  [REJECTED]: 'Sent back',
  [VERIFIED]: 'Verified',
};

export const STATE_FILTERS = [
  { key: 'all', label: 'All' },
  { key: PENDING, label: 'Waiting' },
  { key: REJECTED, label: 'Sent back' },
];

export const stateLabel = (state) => STATE_LABELS[state] || STATE_LABELS[PENDING];

export const VERIFICATION_EVENT = 'iam:verification-changed';

export function notifyVerificationChanged() {
  try {
    window.dispatchEvent(new Event(VERIFICATION_EVENT));
  } catch {  }
}

export const WHO_FILTERS = [
  { key: 'all', label: 'Everyone’s entries' },
  { key: 'others', label: 'Entered by others' },
  { key: 'mine', label: 'Entered by me' },
];

export function filterWaiting(rows, {
  state = 'all', query = '', register = 'all', who = 'all',
} = {}) {
  const q = query.trim().toLowerCase();
  return (rows || []).filter((r) => {
    if (state !== 'all' && (r.verification || PENDING) !== state) return false;
    if (register !== 'all' && r.register !== register) return false;
    if (who === 'mine' && !r.enteredByYou) return false;
    if (who === 'others' && r.enteredByYou) return false;
    if (!q) return true;
    return [r.assetId, r.sapId, r.srl, r.assetTag, r.model, r.type, r.status,
      r.location, r.user, r.createdBy, r.verificationNote]
      .some((v) => String(v || '').toLowerCase().includes(q));
  });
}

export function countByState(rows) {
  const out = { all: 0, [PENDING]: 0, [REJECTED]: 0 };
  (rows || []).forEach((r) => {
    out.all += 1;
    const s = r.verification === REJECTED ? REJECTED : PENDING;
    out[s] += 1;
  });
  return out;
}

export const entries = (n) => `${n.toLocaleString('en-IN')} ${n === 1 ? 'entry' : 'entries'}`;

export function verifiedMessage({
  verified = 0, alreadyVerified = 0, notFound = 0, ownSkipped = 0, sentBackSkipped = 0,
} = {}) {
  const parts = [`Verified ${entries(verified)} into the register.`];
  if (sentBackSkipped) {
    parts.push(`${entries(sentBackSkipped)} sent back ${sentBackSkipped === 1 ? 'is' : 'are'} on hold `
      + 'until corrected.');
  }
  if (ownSkipped) {
    parts.push(`${entries(ownSkipped)} you entered ${ownSkipped === 1 ? 'was' : 'were'} left for `
      + 'another verifier.');
  }
  if (alreadyVerified) parts.push(`${entries(alreadyVerified)} had already been verified.`);
  if (notFound) parts.push(`${entries(notFound)} could not be found — someone may have discarded them.`);
  return parts.join(' ');
}
