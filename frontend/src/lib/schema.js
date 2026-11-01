import { isInStock } from './inventory';
import {
  ASSET, PERIPHERAL, REGISTER_KEYS, SOFTWARE, fieldsOf, labelFor, registerOf,
} from './registers';
import { findSerialOwner, serialTakenMessage } from './serials';

export const SEED_OPTIONS = {
  type: ['LAPTOP', 'MACBOOK', 'DESKTOP', 'MONITOR', 'PRINTER', 'SERVER', 'NETWORK DEVICE', 'MOBILE', 'TABLET', 'OTHER'],
  company: ['AHUICL', 'USL', 'SEBRL', 'Ganesh Realty', 'QMVL', 'ANHVL', 'ARDL', 'AREML', 'Hospitality', 'MIPL',
    'CLASSICAL PARADISE', 'S.E. BUILDERS', 'BAHDL', 'ANI', 'AMBUJA NEOTIA HOLDINGS', 'TO BE GIVEN', 'UTKARSH'],
  site: ['ECOSPACE', 'UTPALAA', 'PATNA', 'ECOHUB', 'HALDIA', 'CCSG', 'RAIPUR', 'UTALIKA', 'UTSODHARAA', 'URVISHA',
    'USSHAR', 'QUEENS PARK', 'VISHWAKARMA', 'ECOCENTRE', 'DIGHA', 'RESIDENCIA', 'CCNT', 'RAICHAK', 'EXTERNAL', 'SOLD'],
  department: ['ACCOUNTS', 'IT', 'FM ACCOUNTS', 'PROCUREMENT & STORES', 'CONTRACTS & PROCUREMENT',
    'FACILITY MANAGEMENT', 'MDS', 'CORPORATE STRATEGY', 'CUSTOMER CARE SERVICES', 'PROJECTS',
    'BUSINESS DEVELOPMENT', 'MARKETING', 'QUALITY ASSURANCE & SAFETY', 'ADMIN', 'SAFETY',
    'MARKETING & EVENTS', 'PURCHASE'],
  floor: ['Grd', '1st', '2nd', '3rd', '4th', '5th', '6th', 'ROOFTOP', 'OUTSIDE'],
  status: ['A', 'B', 'C', 'C - IN STOCK', 'C - LATER ADDED', 'D'],
};

export const COLUMNS = [
  { key: 'srl', label: 'Srl No.', type: 'text', group: 'identification', required: false, filterType: 'text', sortType: 'number', width: 70, scannable: true, headerAliases: ['srl', 'sl', 's.no', 'sno', 'sl no', 'serial number', 'serial no', 'licence key', 'license key', 'product key'] },

  { key: 'assetId', label: 'Asset ID', type: 'text', group: 'identification', required: false, filterType: 'text', width: 110, generated: true, headerAliases: ['asset id', 'assetid', 'amb id', 'peripheral id', 'peripheralid'] },

  { key: 'sapId', label: 'SAP ID', type: 'text', group: 'identification', required: false, filterType: 'text', width: 110, maxLength: 12, digits: 12, headerAliases:['sap id', 'sapid', 'sap', 'sap no', 'sap no.', 'sap number', 'sap asset id', 'sap asset no', 'sap asset number', 'sap code'] },

  { key: 'type', label: 'Asset Type', type: 'select', group: 'identification', required: true, filterType: 'select', options: SEED_OPTIONS.type, width: 110, headerAliases: ['type', 'asset type', 'peripheral type'] },
  { key: 'assetTag', label: 'Computer / Asset Name', type: 'text', group: 'identification', required: true, filterType: 'text', width: 170, headerAliases: ['computer name', 'asset name', 'computer/asset name', 'hostname', 'peripheral name', 'software name'] },
  { key: 'model', label: 'Model', type: 'text', group: 'identification', required: true, filterType: 'text', width: 190, headerAliases: ['model'] },

  { key: 'make', label: 'Make', type: 'select', group: 'identification', required: false, filterType: 'select', width: 100, headerAliases: ['make', 'manufacturer', 'brand', 'oem', 'publisher'] },

  { key: 'description', label: 'Description', type: 'text', group: 'identification', required: true, filterType: 'text', width: 220, headerAliases: ['description'] },
  { key: 'status', label: 'Status', type: 'select', group: 'identification', required: true, filterType: 'select', options: SEED_OPTIONS.status, width: 110, headerAliases: ['status'] },

  { key: 'user', label: 'Assigned User', type: 'text', group: 'assignment', required: true, filterType: 'text', width: 160, onlyIn: ASSET, headerAliases: ['user'] },
  { key: 'email', label: 'Email ID', type: 'email', group: 'assignment', required: false, filterType: 'text', width: 200, onlyIn: ASSET, headerAliases: ['email id', 'email'] },
  { key: 'department', label: 'Department', type: 'select', group: 'assignment', required: false, filterType: 'select', options: SEED_OPTIONS.department, width: 170, headerAliases: ['department'] },

  { key: 'location', label: 'Location', type: 'select', group: 'location', required: true, options: SEED_OPTIONS.site, filterType: 'select', width: 190, headerAliases: ['location'] },
  { key: 'site', label: 'Site', type: 'select', group: 'location', required: false, generated: true, derivedFrom: 'Location', filterType: 'select', options: SEED_OPTIONS.site, width: 170, headerAliases: ['site'] },
  { key: 'floor', label: 'Floor', type: 'select', group: 'location', required: false, filterType: 'select', options: SEED_OPTIONS.floor, width: 90, hiddenInReport: true, headerAliases: ['floor'] },

  { key: 'company', label: 'Company', type: 'select', group: 'procurement', required: true, filterType: 'select', options: SEED_OPTIONS.company, width: 170, headerAliases: ['company'] },
  { key: 'poNo', label: 'PO No.', type: 'text', group: 'procurement', required: false, filterType: 'text', width: 130, maxLength: 10, digits: 10, headerAliases: ['po no', 'po no.', 'po number'] },
  { key: 'dop', label: 'Date of Purchase (DOP)', type: 'date', group: 'procurement', required: false, filterType: 'date', width: 130, headerAliases: ['dop', 'date of purchase'] },
  { key: 'warrantyEnd', label: 'Warranty / AMC End', type: 'date', group: 'procurement', required: false, filterType: 'date', width: 145, headerAliases: ['warranty end', 'warranty', 'warranty expiry', 'warranty expiry date', 'amc end', 'amc expiry', 'warranty / amc end', 'renewal date', 'renewal', 'renews on', 'subscription end', 'licence expiry', 'license expiry'] },
  { key: 'insuranceEnd', label: 'Insurance Expiry', type: 'date', group: 'procurement', required: false, filterType: 'date', width: 135, headerAliases: ['insurance expiry', 'insurance', 'insurance end', 'insurance expiry date', 'insurance end date', 'insurance valid till', 'insurance valid upto', 'insured till'] },
  { key: 'assignedDate', label: 'Assigned Date', type: 'date', group: 'assignment', required: false, filterType: 'date', width: 130, hint: 'Filled in automatically when it is assigned. Change it only to back-date a hand-over.', headerAliases: ['assigned date', 'assignment date', 'date assigned', 'assigned on', 'date of assignment', 'issue date', 'date of issue'] },

  { key: 'comments', label: 'Comments', type: 'textarea', group: 'notes', required: false, filterType: 'text', width: 200, headerAliases: ['comments', 'comment', 'remarks'] },

  { key: 'linkedPeripheralsText', label: 'Linked Peripherals', type: 'text', group: 'identification', required: false, filterType: 'text', width: 220, generated: true, wide: true, onlyIn: ASSET, headerAliases: ['linked peripherals'] },
  { key: 'linkedAssetText', label: 'Linked To', type: 'text', group: 'identification', required: false, filterType: 'text', width: 170, generated: true, onlyIn: PERIPHERAL, headerAliases: ['linked to', 'linked asset'] },

  { key: 'version', label: 'Version', type: 'text', group: 'identification', required: false, filterType: 'text', width: 110, onlyIn: SOFTWARE, maxLength: 100, headerAliases: ['version', 'software version', 'ver'] },
  { key: 'quantity', label: 'Quantity', type: 'number', group: 'procurement', required: false, filterType: 'number', width: 90, onlyIn: SOFTWARE, headerAliases: ['quantity', 'qty', 'seats', 'licences', 'licenses', 'no of licences', 'no of licenses'] },
  { key: 'price', label: 'Price', type: 'text', group: 'procurement', required: false, filterType: 'text', sortType: 'number', width: 110, onlyIn: SOFTWARE, maxLength: 50, headerAliases: ['price', 'cost', 'amount', 'value'] },
  { key: 'vendor', label: 'Vendor / Used By', type: 'text', group: 'procurement', required: false, filterType: 'text', width: 170, onlyIn: SOFTWARE, maxLength: 255, headerAliases: ['vendor', 'vendor / used by', 'used by', 'who uses it', 'supplier', 'vendor or who uses it'] },

  { key: 'availability', label: 'Availability', type: 'text', group: 'identification', required: false, filterType: 'select', width: 110, generated: true, derivedFrom: 'Status', headerAliases: ['availability', 'available'] },
];

export const REPORT_COLUMNS = COLUMNS.filter((col) => !col.hiddenInReport);

export const EXPORT_COLUMNS = COLUMNS;

function relabel(columns, registerKey) {
  const own = fieldsOf(registerKey);
  const picked = own
    ? own.map((key) => columns.find((col) => col.key === key)).filter(Boolean)
    : columns.filter((col) => !col.onlyIn || col.onlyIn === registerKey);
  return picked
    .map((col) => {
      const label = labelFor(col.key, col.label, registerKey);
      return label === col.label ? col : { ...col, label };
    });
}

const COLUMN_SETS = Object.fromEntries(
  REGISTER_KEYS.map((key) => [key, {
    all: relabel(COLUMNS, key),
    report: relabel(REPORT_COLUMNS, key).filter((col) => !col.hiddenInReportFor?.includes(key)),
    export: relabel(EXPORT_COLUMNS, key),
  }]),
);

export function columnsFor(registerKey) {
  return (COLUMN_SETS[registerKey] || COLUMN_SETS[ASSET]).all;
}

export function reportColumnsFor(registerKey) {
  return (COLUMN_SETS[registerKey] || COLUMN_SETS[ASSET]).report;
}

export function exportColumnsFor(registerKey) {
  return (COLUMN_SETS[registerKey] || COLUMN_SETS[ASSET]).export;
}

export function byKeyFor(key, registerKey) {
  return columnsFor(registerKey).find((col) => col.key === key) || null;
}

export const GROUPS = [
  { key: 'identification', label: 'Asset Identification' },
  { key: 'assignment', label: 'Assignment' },
  { key: 'location', label: 'Location' },
  { key: 'procurement', label: 'Procurement' },
  { key: 'notes', label: 'Notes' },
];

export function groupsFor(registerKey) {
  if (registerKey === ASSET || !REGISTER_KEYS.includes(registerKey)) return GROUPS;
  const one = registerOf(registerKey).label.replace(/s$/, '');
  return GROUPS.map((g) => (
    g.key === 'identification' ? { ...g, label: `${one} Identification` } : g
  ));
}

export function isNumericColumn(col) {
  return Boolean(col) && (col.type === 'number' || col.sortType === 'number');
}

export function byKey(key) {
  return COLUMNS.find((col) => col.key === key) || null;
}

export function columnsInGroup(groupKey) {
  return COLUMNS.filter((col) => col.group === groupKey);
}

export function normalizeHeader(h) {
  return String(h || '')
    .toLowerCase()
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const SERIAL_RE = /^[A-Za-z0-9-]+$/;

const QUANTITY_RE = /^\d+(\.0+)?$/;
const PRICE_RE = /^\d+(\.\d{1,2})?$/;
export const cleanPrice = (v) => String(v ?? '').replace(/[\s,₹$€£]|rs\.?|inr/gi, '');

// `original`: the record being edited. A SAP ID or PO number it already has is
// left alone even if it predates the digits rule; a new or changed one is checked.
export function validateAsset(values, {
  register = null, selfId = null, registerKey = ASSET, original = null,
} = {}) {
  const errors = {};
  const software = registerKey === SOFTWARE;
  const released = !software && isInStock(values.status);
  const columns = registerKey === ASSET ? COLUMNS : columnsFor(registerKey);
  columns.forEach((col) => {
    const value = (values[col.key] ?? '').toString().trim();
    if (released && (col.key === 'user' || col.key === 'email' || col.key === 'assetTag')) return;
    if (col.onlyIn && col.onlyIn !== registerKey) return;
    if (col.required && !value) {
      errors[col.key] = 'Required';
    } else if (col.type === 'email' && value && !EMAIL_RE.test(value)) {
      errors[col.key] = 'Enter a valid email address';
    } else if (col.key === 'quantity' && value && !QUANTITY_RE.test(value)) {
      errors[col.key] = 'A whole number, like 5';
    } else if (col.key === 'price' && value && !PRICE_RE.test(cleanPrice(value))) {
      errors[col.key] = 'An amount, like 12500 or 12500.50';
    } else if (col.key === 'srl' && value && (!SERIAL_RE.test(value) || value.includes('--'))
      && !(original && value.toUpperCase() === String(original.srl ?? '').trim().toUpperCase())) {
      errors[col.key] = SERIAL_RE.test(value) ? 'No two hyphens in a row' : 'Letters, numbers and hyphens only';
    } else if (col.type === 'date' && value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      errors[col.key] = 'Use dd-mm-yyyy, a real date';
    } else if (col.digits && value && !new RegExp(`^\\d{${col.digits}}$`).test(value)
      && !(original && value === String(original[col.key] ?? '').trim())) {
      errors[col.key] = `Exactly ${col.digits} digits`;
    }
  });

  if (register && !errors.srl) {
    const owner = findSerialOwner(register, values.srl, selfId);
    if (owner) errors.srl = serialTakenMessage(owner);
  }
  return errors;
}

export function emptyAsset(registerKey = ASSET) {
  const out = {};
  (fieldsOf(registerKey) ? columnsFor(registerKey) : COLUMNS.filter((col) => col.onlyIn !== SOFTWARE))
    .forEach((col) => { out[col.key] = ''; });
  return out;
}

export const CLONE_BLANK_KEYS = [
  'srl', 'sapId', 'assetTag', 'description', 'user', 'email',
  'warrantyEnd', 'insuranceEnd', 'assignedDate', 'linkedPeripheralsText',
];

export const CLONE_PREFILLED_KEYS = [
  'status', 'location', 'floor', 'department', 'company',
];

const CLONE_BLANK = new Set(CLONE_BLANK_KEYS);
const CLONE_EDITABLE = new Set([...CLONE_BLANK_KEYS, ...CLONE_PREFILLED_KEYS]);

export function isCloneBlank(key) {
  return CLONE_BLANK.has(key);
}

export function isCloneEditable(key) {
  return CLONE_EDITABLE.has(key);
}

export function cloneAsset(record, registerKey = ASSET) {
  const out = {};
  (fieldsOf(registerKey) ? columnsFor(registerKey) : COLUMNS.filter((col) => col.onlyIn !== SOFTWARE))
    .forEach((col) => {
    const blanked = isCloneBlank(col.key) || col.generated;
    out[col.key] = blanked ? '' : (record?.[col.key] ?? '');
  });
  return out;
}
