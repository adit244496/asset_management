export const ASSET = 'asset';
export const PERIPHERAL = 'peripheral';
export const SOFTWARE = 'software';

export const REGISTERS = {
  [ASSET]: {
    key: ASSET,
    path: 'assets',
    label: 'Assets',
    one: 'asset',
    many: 'assets',
    idPrefix: 'AMB',
    labels: {},
  },
  [PERIPHERAL]: {
    key: PERIPHERAL,
    path: 'peripherals',
    label: 'Peripherals',
    one: 'peripheral',
    many: 'peripherals',
    idPrefix: 'PRP',
    labels: {
      assetId: 'Peripheral ID',
      type: 'Peripheral Type',
      assetTag: 'Peripheral Name',
    },
  },
  [SOFTWARE]: {
    key: SOFTWARE,
    path: 'softwares',
    label: 'Softwares',
    one: 'software',
    many: 'softwares',
    idPrefix: 'SFT',
    fields: ['assetTag', 'version', 'status', 'srl', 'quantity', 'poNo',
      'warrantyEnd', 'price', 'vendor', 'comments'],
    labels: {
      assetId: 'Software ID',
      assetTag: 'Software Name',
      srl: 'Serial Number',
      poNo: 'PO Number',
      warrantyEnd: 'Renewal Date',
      comments: 'Comment',
    },
  },
};

export const REGISTER_KEYS = [ASSET, PERIPHERAL, SOFTWARE];

export const REGISTER_LIST = REGISTER_KEYS.map((key) => REGISTERS[key]);

export function registerOf(key) {
  return REGISTERS[key] || REGISTERS[ASSET];
}

export function isRegisterKey(key) {
  return Object.prototype.hasOwnProperty.call(REGISTERS, key);
}

export function pathOf(key) {
  return registerOf(key).path;
}

export function labelFor(columnKey, defaultLabel, registerKey) {
  return registerOf(registerKey).labels[columnKey] || defaultLabel;
}

export function fieldsOf(registerKey) {
  return registerOf(registerKey).fields || null;
}

export function isHardware(registerKey) {
  return registerKey === ASSET || registerKey === PERIPHERAL;
}
