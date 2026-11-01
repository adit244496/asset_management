export function templateColumns(columns) {
  return columns.filter((col) => !col.generated);
}

export const UPLOAD_ONLY_COLUMNS = [
  {
    key: 'dateOfJoining', label: 'Date of Joining', type: 'date', uploadOnly: true, width: 120,
    headerAliases: ['date of joining', 'doj', 'joining date', 'date joined'],
    after: 'email',
  },
];

export function withUploadColumns(columns, registerKey) {
  if (registerKey && registerKey !== 'asset') return columns;
  const out = [...columns];
  UPLOAD_ONLY_COLUMNS.forEach((extra) => {
    const at = out.findIndex((c) => c.key === extra.after);
    out.splice(at < 0 ? out.length : at + 1, 0, extra);
  });
  return out;
}

export function templateHeaderRow(columns) {
  return templateColumns(columns).map((col) => col.label);
}

const TYPE_LABEL = {
  text: 'Text',
  textarea: 'Text',
  email: 'Email address',
  number: 'Number',
  date: 'Date',
  select: 'Text (from a list)',
};

const EXAMPLE_VALUES = {
  srl: '5CG1234ABC',
  sapId: '100000012345',
  type: 'LAPTOP',
  assetTag: 'LTITSAMPLE',
  model: 'Dell Latitude 3520 (15.6") - i5',
  make: 'DELL',
  description: 'Dell Latitude 3520 (15.6") - i5 / 16GB / 512GB SSD [H6RP9G3]',
  status: 'In Use',
  user: 'Sample User',
  email: 'name@ambujaneotia.com',
  department: 'IT',
  location: 'ECOSPACE 4B',
  site: 'ECOSPACE',
  floor: '3rd',
  company: 'AHUICL',
  poNo: '4500012345',
  dop: '15-04-2026',
  warrantyEnd: '14-04-2029',
  insuranceEnd: '14-04-2027',
  assignedDate: '20-04-2026',
  dateOfJoining: '02-03-2026',
  comments: 'Replaced an older unit. Keyboard changed under warranty in 2027.',
};

const SOFTWARE_EXAMPLE_VALUES = {
  assetTag: 'Microsoft Office',
  version: '2021 LTSC',
  srl: 'XXXXX-XXXXX-XXXXX-XXXXX',
  quantity: '25',
  warrantyEnd: '31-03-2027',
  price: '125000',
  vendor: 'Microsoft (via Rediff Infotech)',
  comments: 'Volume licence for the Accounts team.',
};

function fallbackExample(col, optionsFor) {
  if (col.type === 'date') return '15-04-2026';
  if (col.type === 'email') return 'name@ambujaneotia.com';
  if (col.type === 'number') return '1';
  if (col.type === 'select') {
    const values = (typeof optionsFor === 'function' ? optionsFor(col.key) : null) || col.options || [];
    return values[0] || '';
  }
  return '';
}

export function exampleFor(col, optionsFor, registerKey = null) {
  const own = registerKey === 'software' ? SOFTWARE_EXAMPLE_VALUES[col.key] : undefined;
  const given = own !== undefined ? own : EXAMPLE_VALUES[col.key];
  return given === undefined ? fallbackExample(col, optionsFor) : given;
}

const MAX_LISTED_VALUES = 12;

export function templateFieldGuide(columns, optionsFor, registerKey = null) {
  const software = registerKey === 'software';
  return templateColumns(columns).map((col) => {
    const notes = [];

    if (col.key === 'srl') {
      notes.push(software
        ? 'The licence serial or product key. Optional, but no two licences may share one.'
        : 'The serial number on the device. Fine to leave blank and scan or type it in later.');
      notes.push('Letters, numbers and hyphens only — a row with a space, / or any other symbol in it '
        + 'is not imported. Saved in capitals.');
    }
    if (col.key === 'quantity') {
      notes.push('How many seats or copies the licence covers, as a whole number. Optional.');
    }
    if (col.key === 'price') {
      notes.push('The amount, like 125000 or 125000.50. Commas and ₹ are fine; anything else '
        + 'is cleared and reported, and the rest of the row is still imported. Optional.');
    }
    if (software && col.key === 'warrantyEnd') {
      notes.push('When the licence or subscription is next due for renewal. Optional.');
    }
    if (col.key === 'sapId') {
      notes.push('This record’s number in SAP, copied exactly as SAP shows it. '
        + 'Optional — leave blank if it has not been entered in SAP yet.');
    }
    if (col.key === 'insuranceEnd') {
      notes.push('The last day the item is insured, from the policy. Optional — '
        + 'blank means not recorded, not "insured".');
    }
    if (col.key === 'dateOfJoining') {
      notes.push('The joining date of the person in Assigned User. Used only when "Also create '
        + 'user records" is ticked: their new account gets it, and so does an existing account '
        + 'that has none. Not stored on the asset. Optional.');
    }
    if (col.key === 'assignedDate') {
      notes.push('When it was handed to the Assigned User. Leave blank and the import '
        + 'date is used for every row with an Assigned User; fill it in only to record '
        + 'an earlier hand-over. Ignored for a row with nobody assigned.');
    }
    if (col.digits) {
      notes.push(`Exactly ${col.digits} digits, numbers only — a row with any other value is not `
        + 'imported. If yours can start with 0, format this column as Text before typing.');
    } else if (col.maxLength) {
      notes.push(`At most ${col.maxLength} characters.`);
    }
    if (col.type === 'date') {
      notes.push('Use dd-mm-yyyy, e.g. 15-04-2026. A real Excel date cell, 15/04/2026 or 15.04.26 is also read correctly.');
    }
    if (col.type === 'email') {
      notes.push('Must be a valid address, or left blank. An unusable value is cleared and reported, and the rest of the row is still imported.');
    }
    if (col.type === 'select') {
      const values = (typeof optionsFor === 'function' ? optionsFor(col.key) : null) || col.options || [];
      if (values.length) {
        const shown = values.slice(0, MAX_LISTED_VALUES).join(', ');
        notes.push(values.length > MAX_LISTED_VALUES
          ? `Current values include: ${shown}, and ${values.length - MAX_LISTED_VALUES} more.`
          : `Current values: ${shown}.`);
      }
      notes.push('A value that is not on the list yet is added to the master list automatically.');
    }
    if (col.required) {
      notes.push('A row with this left blank is not imported.');
    }

    if (!notes.length) {
      notes.push('Optional. Free text, or leave blank.');
    }

    return {
      Column: col.label,
      Required: col.required ? 'Yes' : 'No',
      Format: TYPE_LABEL[col.type] || 'Text',
      Example: exampleFor(col, optionsFor, registerKey),
      'What to enter': notes.join(' '),
    };
  });
}

const GUIDE_ROW_KEYS = ['Required', 'Format', 'Example', 'What to enter'];

export function templateFieldGuideRows(columns, optionsFor, registerKey = null) {
  const guide = templateFieldGuide(columns, optionsFor, registerKey);
  return [
    ['Column', ...guide.map((g) => g.Column)],
    ...GUIDE_ROW_KEYS.map((key) => [key, ...guide.map((g) => g[key])]),
  ];
}

export function templateColumnWidths(columns) {
  return templateColumns(columns).map((col) => ({
    wch: Math.max(12, Math.min(40, Math.round((col.width || 120) / 7))),
  }));
}

export function fieldGuideWidths(columns) {
  return [
    { wch: 16 },
    ...templateColumns(columns).map(() => ({ wch: 30 })),
  ];
}

export const DATA_SHEET_NAME = 'Asset Import';
export const GUIDE_SHEET_NAME = 'Field Guide';
