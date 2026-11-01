const ID = '[0-9a-fA-F-]{36}';
const ALLOWED = [
  { method: 'PATCH', path: new RegExp(`^/(assets|peripherals)/${ID}$`) },
  { method: 'POST', path: new RegExp(`^/(assets|peripherals)/${ID}/transfer$`) },
];

export function isAllowedProposalRequest(proposal) {
  if (!proposal || typeof proposal.path !== 'string') return false;
  const method = String(proposal.method || '').toUpperCase();
  return ALLOWED.some((rule) => rule.method === method && rule.path.test(proposal.path));
}

export const MODE_ANSWER = 'answer';
export const MODE_CHANGES = 'changes';

export const MODE_LABELS = {
  [MODE_ANSWER]: 'Answer only',
  [MODE_CHANGES]: 'Can make changes',
};

const MODE_KEY = 'iam_assistant_mode_v1';

export function storedMode(canMakeChanges) {
  try {
    const saved = localStorage.getItem(MODE_KEY);
    if (saved === MODE_CHANGES && canMakeChanges) return MODE_CHANGES;
  } catch {  }
  return MODE_ANSWER;
}

export function rememberMode(mode) {
  try { localStorage.setItem(MODE_KEY, mode); } catch {  }
}

export function diffLine(d) {
  const from = d.from == null || d.from === '' ? '—' : String(d.from);
  const to = d.to == null || d.to === '' ? '—' : String(d.to);
  return { label: d.label || d.field, from, to };
}

export const IDLE_MINUTES = 30;

export function shouldStartFresh(conversation, now = Date.now()) {
  if (!conversation || conversation.limitReached) return true;
  const times = (conversation.items || []).map((i) => Date.parse(i.at)).filter((t) => !Number.isNaN(t));
  if (!times.length) return false;
  return now - Math.max(...times) > IDLE_MINUTES * 60 * 1000;
}

export const OUTCOME_LABELS = {
  pending: 'Waiting for you',
  confirmed: 'Applied',
  declined: 'Declined',
  failed: 'Refused by the app',
};
