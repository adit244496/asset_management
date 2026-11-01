import { byKeyFor, columnsFor } from './schema';

export const LINK_LABELS = {
  linkedPeripherals: 'Linked peripherals',
  linkedAsset: 'Linked to',
  movedFrom: 'Moved from',
};

export const RETIRED_LABELS = {
  doj: 'Date of Joining',
};

export function fieldLabel(key, register) {
  if (!key) return '';
  return LINK_LABELS[key] || byKeyFor(key, register)?.label || RETIRED_LABELS[key] || key;
}

const KIND_BY_GROUP = {
  location: 'moved',
  assignment: 'reassigned',
};

const KIND_BY_FIELD = {
  status: 'status',
  linkedPeripherals: 'linked',
  linkedAsset: 'linked',
  vendor: 'reassigned',
};

const WHOLE_ITEM_ACTIONS = new Set([
  'created', 'imported', 'deleted', 'restored', 'verified', 'rejected', 'discarded',
]);

export function kindOf(event, register) {
  if (!event) return 'updated';
  if (WHOLE_ITEM_ACTIONS.has(event.action)) return event.action;
  const key = event.field;
  if (!key) return 'updated';
  if (KIND_BY_FIELD[key]) return KIND_BY_FIELD[key];
  const group = byKeyFor(key, register)?.group;
  return KIND_BY_GROUP[group] || 'updated';
}

export const GROUP_WINDOW_MS = 1000;

export function groupEvents(events, { register, windowMs = GROUP_WINDOW_MS } = {}) {
  const groups = [];
  let open = null;

  (events || []).forEach((event) => {
    const kind = kindOf(event, register);
    const at = Date.parse(event.at);
    const actor = event.actor || null;

    const joins = open
      && open.kind === kind
      && open.actor === actor
      && open.action === event.action
      && event.action === 'updated'
      && Number.isFinite(at)
      && Number.isFinite(open.firstAt)
      && Math.abs(open.firstAt - at) <= windowMs
      && !open.fields.has(event.field);

    if (joins) {
      open.events.push(event);
      open.fields.add(event.field);
      return;
    }

    open = {
      id: event.id,
      kind,
      action: event.action,
      actor,
      at: event.at,
      firstAt: at,
      fields: new Set([event.field]),
      events: [event],
    };
    groups.push(open);
  });

  return groups
    .map((group) => ({
      id: group.id,
      kind: group.kind,
      action: group.action,
      actor: group.actor,
      at: group.at,
      events: sortByColumnOrder(group.events, register),
    }))
    .sort(compareGroups);
}

const KIND_ORDER = ['status', 'moved', 'reassigned', 'linked', 'updated'];

function compareGroups(a, b) {
  const at = Date.parse(b.at) - Date.parse(a.at);
  if (at) return at;
  const ai = KIND_ORDER.indexOf(a.kind);
  const bi = KIND_ORDER.indexOf(b.kind);
  if (ai === -1 || bi === -1) return 0;
  return ai - bi;
}

function sortByColumnOrder(events, register) {
  const order = new Map(columnsFor(register).map((col, i) => [col.key, i]));
  return [...events].sort((a, b) => {
    const ai = order.has(a.field) ? order.get(a.field) : Number.MAX_SAFE_INTEGER;
    const bi = order.has(b.field) ? order.get(b.field) : Number.MAX_SAFE_INTEGER;
    return ai - bi;
  });
}

const HEADLINES = {
  moved: 'Moved',
  reassigned: 'Reassigned',
  status: 'Status changed',
  updated: 'Updated',
  created: 'Added to the register',
  imported: 'Imported from a spreadsheet',
  deleted: 'Deleted',
  restored: 'Restored',
  verified: 'Verified into the register',
  rejected: 'Sent back for correction',
  discarded: 'Discarded before verification',
};

export function groupHeadline(group) {
  if (!group) return '';
  if (group.kind === 'linked') {
    return group.events.some((e) => e.field === 'linkedAsset')
      ? 'Moved to another asset'
      : 'Peripherals changed';
  }
  const split = group.kind === 'created' && group.events.find((e) => e.field === 'movedFrom');
  if (split) return `Moved here from ${split.oldValue} — ${split.newValue}`;
  const bySap = group.kind === 'verified' && group.events.find((e) => e.field === 'sapId');
  if (bySap) return `Into the register without verification — it has SAP ID ${bySap.newValue}`;
  return HEADLINES[group.kind] || group.action || 'Changed';
}

const LEAD_FIELDS = {
  moved: ['site', 'location', 'floor'],
  reassigned: ['user', 'vendor', 'department', 'email'],
};

export function groupLead(group) {
  if (!group?.events?.length) return null;
  const preferred = LEAD_FIELDS[group.kind] || [];
  for (const key of preferred) {
    const hit = group.events.find((e) => e.field === key);
    if (hit) return hit;
  }
  return group.events[0];
}

const ORDINAL_FLOOR = /^(\d+(st|nd|rd|th)?|grd|gf|ground|lg|ug|b\d?|basement)$/i;
const NO_FLOOR = new Set(['', 'n/a', 'na', 'n.a.', 'none', 'nil', '-', '--']);

export function floorText(value) {
  const clean = (value ?? '').toString().trim();
  if (NO_FLOOR.has(clean.toLowerCase())) return null;
  return ORDINAL_FLOOR.test(clean) ? `${clean} Floor` : clean;
}

export function placeText(values = {}) {
  const clean = (v) => (v ?? '').toString().trim();
  const site = clean(values.site);
  const location = clean(values.location);

  const parts = [];
  if (site && !(location && location.toLowerCase().includes(site.toLowerCase()))) {
    parts.push(site);
  }
  if (location) parts.push(location);

  const where = parts.join(' · ');
  const floor = floorText(values.floor);
  if (where && floor) return `${where} (${floor})`;
  return where || floor || '';
}

export function personText(values = {}) {
  const clean = (v) => (v ?? '').toString().trim();
  const name = clean(values.user);
  const email = clean(values.email);
  const department = clean(values.department);

  let who = '';
  if (name && email) who = `${name} (${email})`;
  else who = name || email;

  return [who, department].filter(Boolean).join(' · ');
}

const COMPOSED = {
  moved: {
    fields: ['site', 'location', 'floor'],
    text: placeText,
  },
  reassigned: {
    fields: ['user', 'email', 'department'],
    text: personText,
  },
};

export function composedChange(group) {
  const spec = COMPOSED[group?.kind];
  if (!spec) return null;
  const before = {};
  const after = {};
  group.events.forEach((e) => {
    if (!spec.fields.includes(e.field)) return;
    before[e.field] = e.oldValue;
    after[e.field] = e.newValue;
  });
  return { from: spec.text(before), to: spec.text(after) };
}

export function isExpandable(group) {
  const events = group?.events || [];
  if (events.length <= 1) return false;
  const spec = COMPOSED[group.kind];
  if (spec && events.every((e) => spec.fields.includes(e.field))) return false;
  return true;
}
