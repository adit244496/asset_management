// "Used for" of an Asset Type (backend app/type_codes.py): which Data Entry
// offers it. Assets offer asset types, Peripherals peripheral types; "both"
// is offered in both. Softwares have no type.
export const USED_FOR_OPTIONS = [
  { value: 'asset', label: 'Assets only' },
  { value: 'peripheral', label: 'Peripherals only' },
  { value: 'both', label: 'Both assets and peripherals' },
];

export const USED_FOR_SHORT = { asset: 'Assets', peripheral: 'Peripherals', both: 'Both' };
