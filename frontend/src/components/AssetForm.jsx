import { useMemo, useState } from 'react';
import { errorMessage } from '../api';
import { useAssets } from '../context/AssetsContext';
import { useAuth } from '../context/AuthContext';
import { isInStock, isInUse, usageOptions } from '../lib/inventory';
import { ASSET, PERIPHERAL, SOFTWARE } from '../lib/registers';
import { SERIAL_MASK, isSerialMask, revealSerial, useSerialAccess } from '../lib/serialAccess';
import { columnsFor, groupsFor } from '../lib/schema';
import AssignedUserField from './AssignedUserField';
import BarcodeInput from './BarcodeInput';
import DateInput from './DateInput';
import LinkPeripherals from './LinkPeripherals';

const AssetForm = ({
  values, errors = {}, onChange, idPrefix = 'asset', register = null,
  linked = [], onLinkChange = null, linkDisabled = false, linkRef = null, linkHighlight = false,
  originalStatus = null,
  onlyFields = null,
  fieldLabels = null,
  // Leave out the values the system works out itself (Asset ID, Site,
  // Availability, Linked To); an asset's Link Peripherals stays (it is editable).
  hideGenerated = false,
}) => {
  const { formOptionsFor, register: current } = useAssets();
  const reg = register || current;
  const canRevealSerial = useSerialAccess();
  const { canEdit } = useAuth();
  // The serial number the record had when this form opened (XXXX for a
  // hidden software key). Emptying the box removes it -- with a warning here,
  // and a confirmation when saving (AssetModal).
  const [serialAtStart] = useState(() => String(values?.srl ?? '').trim());
  const [revealing, setRevealing] = useState(false);
  const [revealError, setRevealError] = useState('');
  const showSavedSerial = async () => {
    setRevealing(true);
    setRevealError('');
    try {
      onChange('srl', await revealSerial(values.id));
    } catch (err) {
      setRevealError(errorMessage(err, 'Could not show the serial number.'));
    } finally {
      setRevealing(false);
    }
  };
  const allColumns = columnsFor(reg).filter((c) => !hideGenerated || !c.generated
    || (c.key === 'linkedPeripheralsText' && onLinkChange));
  const picked = onlyFields
    ? onlyFields.map((key) => allColumns.find((c) => c.key === key)).filter(Boolean)
    : allColumns;
  const columns = fieldLabels
    ? picked.map((c) => (fieldLabels[c.key] ? { ...c, label: fieldLabels[c.key] } : c))
    : picked;
  const groups = useMemo(() => {
    const all = groupsFor(reg);
    const at = (key) => all.findIndex((g) => g.key === key);
    const [assignment, location] = [at('assignment'), at('location')];
    if (assignment < 0 || location < 0 || location < assignment) return all;
    const moved = [...all];
    moved.splice(assignment, 0, ...moved.splice(location, 1));
    return moved;
  }, [reg]);

  const inStock = isInStock(values.status);
  const released = (key) => inStock && (key === 'user' || key === 'email');
  const isAssetForm = reg === ASSET;
  const nameCleared = isAssetForm && inStock && Boolean(originalStatus) && !isInStock(originalStatus);
  const optionalInStock = (key) => inStock && key === 'assetTag';

  const renderControl = (col) => {
    const id = `${idPrefix}_${col.key}`;
    const value = values[col.key] ?? '';
    const invalid = !!errors[col.key];

    if (released(col.key)) {
      return (
        <>
          <input
            id={id}
            className="field-input"
            type="text"
            value=""
            disabled
            readOnly
            placeholder={col.key === 'user'
              ? 'Nobody — it is in stock'
              : 'No holder, no address'}
          />
          {col.key === 'user' && (
            <p className="field-hint">
              In stock means nobody has it, so the holder and their Email ID are
              released when you save
              {(values.user || values.email) && (
                <> &mdash; <strong>{[values.user, values.email].filter(Boolean).join(' / ')}</strong>
                  {' '}will be cleared
                </>
              )}.
            </p>
          )}
        </>
      );
    }

    if (col.key === 'assetTag' && nameCleared) {
      return (
        <>
          <input id={id} className="field-input" type="text" value="" disabled readOnly
            placeholder="Cleared — it goes into stock unnamed" />
          <p className="field-hint">
            Going into stock clears the name
            {values.assetTag ? <> &mdash; <strong>{values.assetTag}</strong> will be cleared</> : null}.
            {' '}Give it a new one when you assign it.
          </p>
        </>
      );
    }

    if (col.key === 'linkedPeripheralsText' && onLinkChange) {
      return (
        <LinkPeripherals
          ref={linkRef}
          value={linked}
          onChange={onLinkChange}
          disabled={linkDisabled}
          highlight={linkHighlight}
        />
      );
    }

    if (col.generated) {
      return (
        <input
          id={id}
          className="field-input"
          type="text"
          value={value}
          disabled
          readOnly
          placeholder={col.derivedFrom
            ? `Set from ${col.derivedFrom} when you save`
            : 'Assigned automatically on save'}
        />
      );
    }

    if (col.key === 'user') {
      const sold = /sold/i.test(String(values.status || ''));
      const typedPrefix = sold && /^\s*sold(\s+to\b|\s*[-:])/i.test(String(value));
      return (
        <>
          <AssignedUserField
            id={id}
            value={value}
            email={values.email}
            location={values.location}
            invalid={invalid}
            onChange={(v) => onChange(col.key, v)}
            onEmailChange={(v) => onChange('email', v)}
            onLocationChange={(v) => onChange('location', v)}
            floor={values.floor}
            onFloorChange={(v) => onChange('floor', v)}
          />
          {sold && (
            <p className="field-hint">
              Sold — enter the buyer’s name only; the status already says it was sold
              {typedPrefix ? <> (“SOLD TO” will be dropped when you save)</> : null}.
            </p>
          )}
        </>
      );
    }

    if (col.scannable) {
      // A software's saved serial number comes masked (XXXX): the box starts
      // empty and, untouched, keeps the saved key (the server ignores XXXX).
      // Emptying the box -- or "Remove it" for a hidden key -- removes it.
      const isSerial = col.key === 'srl';
      const hiddenKey = isSerial && reg === SOFTWARE && isSerialMask(value);
      // Emptying a saved serial warns first -- except for software, whose
      // Serial Number may simply be left blank.
      const removing = isSerial && reg !== SOFTWARE && Boolean(serialAtStart) && !String(value ?? '').trim();
      const savedShown = isSerialMask(serialAtStart) ? 'the saved serial number' : serialAtStart;
      return (
        <>
          <BarcodeInput
            id={id}
            value={hiddenKey ? '' : value}
            invalid={invalid}
            placeholder={hiddenKey ? `Saved and hidden (${SERIAL_MASK}) — leave empty to keep it`
              : (removing ? 'Empty — the serial number will be removed' : undefined)}
            onChange={(v) => onChange(col.key, isSerial ? String(v ?? '').toUpperCase() : v)}
          />
          {hiddenKey && (
            <p className="field-hint">
              The saved serial number is hidden. Scan or type a new one only to replace it.
              {canRevealSerial && values.id && (
                <>
                  {' '}
                  <button type="button" className="link-btn" disabled={revealing} onClick={showSavedSerial}>
                    {revealing ? 'Loading…' : 'Show it here'}
                  </button>
                </>
              )}
              {canEdit && values.id && (
                <>
                  {' · '}
                  <button type="button" className="link-btn" onClick={() => onChange(col.key, '')}>
                    Remove it
                  </button>
                </>
              )}
              {revealError && <span className="field-error-inline"> {revealError}</span>}
            </p>
          )}
          {removing && (
            <p className="field-hint field-warn-inline" role="alert">
              {col.label} is empty — saving will remove {savedShown} from this record.
              {' '}
              <button type="button" className="link-btn" onClick={() => onChange(col.key, serialAtStart)}>
                Undo
              </button>
            </p>
          )}
        </>
      );
    }

    if (col.type === 'select') {
      // A software's Usage: In Use or In Stock only.
      // Only assets are sold: a peripheral's Status does not offer SOLD
      // (a record already sold keeps showing its value).
      const options = reg === SOFTWARE && col.key === 'status'
        ? usageOptions(formOptionsFor('status'), value)
        : reg === PERIPHERAL && col.key === 'status'
          ? formOptionsFor(col.key, value).filter((v) => !/sold/i.test(v) || v === value)
          : formOptionsFor(col.key, value);
      return (
        <select
          id={id}
          className={`field-input${invalid ? ' has-error' : ''}`}
          value={value}
          onChange={(e) => onChange(col.key, e.target.value)}
        >
          <option value="">{`Select ${col.label}`}</option>
          {options.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
      );
    }

    if (col.type === 'textarea') {
      return (
        <textarea
          id={id}
          className={`field-input${invalid ? ' has-error' : ''}`}
          rows={2}
          value={value}
          onChange={(e) => onChange(col.key, e.target.value)}
        />
      );
    }

    // Assigned Date only while In Use: read-only otherwise (removed on the
    // way into stock, kept as it was for other statuses such as SOLD).
    if (col.key === 'assignedDate' && reg !== SOFTWARE && !isInUse(values.status)) {
      const stock = isInStock(values.status);
      return (
        <>
          <DateInput
            id={id}
            className="field-input"
            value={stock ? '' : value}
            onChange={() => { }}
            disabled
            placeholder={stock ? 'None — it is in stock' : 'Only while In Use'}
          />
          <p className="field-hint">
            {stock
              ? (value ? 'Going into stock removes the Assigned Date when you save.' : 'Nothing is assigned while it is in stock.')
              : `Can only be set while the status is In Use${value ? ' — the saved date is kept' : ''}.`}
          </p>
        </>
      );
    }

    if (col.type === 'date') {
      return (
        <DateInput
          id={id}
          className={`field-input${invalid ? ' has-error' : ''}`}
          value={value}
          onChange={(v) => onChange(col.key, v)}
        />
      );
    }
    const inputType = col.type === 'email' ? 'email' : (col.type === 'number' ? 'number' : 'text');
    return (
      <input
        id={id}
        className={`field-input${invalid ? ' has-error' : ''}`}
        type={inputType}
        value={value}
        maxLength={col.maxLength}
        inputMode={col.digits ? 'numeric' : undefined}
        onChange={(e) => onChange(col.key, e.target.value)}
      />
    );
  };

  const renderField = (col) => (
    <div
      className={`field${col.type === 'textarea' || col.wide ? ' field-wide' : ''}`}
      key={col.key}
    >
      <label htmlFor={`${idPrefix}_${col.key}`}>
        {col.label}
        {col.required && !released(col.key) && !optionalInStock(col.key) ? ' *' : ''}
      </label>
      {renderControl(col)}
      {col.hint && !col.generated
        && !(col.key === 'assignedDate' && !isInUse(values.status))
        && <p className="field-hint">{col.hint}</p>}
      <div className="field-error">{errors[col.key] || ''}</div>
    </div>
  );

  if (onlyFields) {
    return (
      <div className="form-section">
        <div className="form-grid">{columns.map(renderField)}</div>
      </div>
    );
  }

  return (
    <>
      {groups.map((group) => {
        const cols = columns.filter((c) => c.group === group.key);
        if (!cols.length) return null;
        return (
          <div className="form-section" key={group.key}>
            <h3>{group.label}</h3>
            <div className="form-grid">{cols.map(renderField)}</div>
          </div>
        );
      })}
    </>
  );
};

export default AssetForm;
