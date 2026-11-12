import { useMemo, useState } from 'react';
import { errorMessage } from '../api';
import { useAssets } from '../context/AssetsContext';
import { isInStock, isInUse } from '../lib/inventory';
import { ASSET, SOFTWARE } from '../lib/registers';
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
}) => {
  const { formOptionsFor, register: current } = useAssets();
  const reg = register || current;
  const canRevealSerial = useSerialAccess();
  const [keyHiddenAtStart] = useState(() => isSerialMask(values?.srl));
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
  const allColumns = columnsFor(reg);
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
      // empty, and left empty the saved key is kept (the server ignores XXXX).
      const hiddenKey = reg === SOFTWARE && col.key === 'srl' && isSerialMask(value);
      return (
        <>
          <BarcodeInput
            id={id}
            value={hiddenKey ? '' : value}
            invalid={invalid}
            placeholder={hiddenKey ? `Saved and hidden (${SERIAL_MASK}) — leave empty to keep it` : undefined}
            onChange={(v) => onChange(col.key, col.key === 'srl'
              // Emptied again: keep the saved (hidden) key rather than erase it.
              ? (String(v ?? '').toUpperCase() || (reg === SOFTWARE && keyHiddenAtStart ? SERIAL_MASK : ''))
              : v)}
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
              {revealError && <span className="field-error-inline"> {revealError}</span>}
            </p>
          )}
        </>
      );
    }

    if (col.type === 'select') {
      return (
        <select
          id={id}
          className={`field-input${invalid ? ' has-error' : ''}`}
          value={value}
          onChange={(e) => onChange(col.key, e.target.value)}
        >
          <option value="">{`Select ${col.label}`}</option>
          {formOptionsFor(col.key, value).map((v) => <option key={v} value={v}>{v}</option>)}
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
