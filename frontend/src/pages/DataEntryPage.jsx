import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { errorMessage } from '../api';
import AssetForm from '../components/AssetForm';
import Banner from '../components/Banner';
import BulkUpload from '../components/BulkUpload';
import PoReminderDialog from '../components/PoReminderDialog';
import RegisterToggle from '../components/RegisterToggle';
import { useAssets } from '../context/AssetsContext';
import { useAuth } from '../context/AuthContext';
import { ASSET, registerOf } from '../lib/registers';
import { emptyAsset, validateAsset } from '../lib/schema';
import { notifyVerificationChanged } from '../lib/verification';
import './DataEntryPage.css';

const DataEntryPage = () => {
  const { assets, createAsset, register, meta } = useAssets();
  const { isAdmin } = useAuth();
  const isAssets = register === ASSET;
  const location = useLocation();
  const navigate = useNavigate();
  const cloneValues = location.state?.cloneValues;

  const [values, setValues] = useState(() => (cloneValues
    ? { ...emptyAsset(register), ...cloneValues } : emptyAsset(register)));
  const [cloning, setCloning] = useState(() => !!cloneValues);
  const [errors, setErrors] = useState({});
  const [linked, setLinked] = useState([]);
  const linkRef = useRef(null);
  const [banner, setBanner] = useState(cloneValues
    ? {
      text: 'Cloned. Fill in what is blank — serial, name, description, who it '
        + 'is for, the warranty and joining dates, and any peripherals. Status, '
        + 'location, floor, department and company are pre-filled but can be '
        + 'changed; the rest is carried from the original and locked until the '
        + 'new record exists.',
      kind: 'info',
      sticky: true,
    }
    : null);
  const [saving, setSaving] = useState(false);
  const [poReminder, setPoReminder] = useState(false);
  const poLabel = registerOf(register).labels.poNo || 'PO No.';

  useEffect(() => {
    if (cloneValues) {
      navigate(location.pathname, { replace: true, state: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const firstRegister = useRef(register);
  useEffect(() => {
    if (firstRegister.current === register) return;
    firstRegister.current = register;
    resetForm();
    setBanner(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [register]);

  const handleChange = (key, value) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  };

  const resetForm = () => {
    setValues(emptyAsset(register));
    setErrors({});
    setLinked([]);
    setCloning(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const found = validateAsset(values, { register: assets, registerKey: register });
    if (Object.keys(found).length) {
      setErrors(found);
      setBanner({ text: 'Please fix the highlighted fields before submitting.', kind: 'error' });
      return;
    }
    if (!String(values.poNo ?? '').trim()) {
      setPoReminder(true);
      return;
    }
    await save();
  };

  const backToPo = () => {
    setPoReminder(false);
    setTimeout(() => {
      const box = document.getElementById('entry_poNo');
      box?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      box?.focus();
    }, 0);
  };

  const save = async () => {
    setPoReminder(false);
    let toLink = linked;
    if (isAssets && linkRef.current) {
      const flushed = await linkRef.current.flush();
      if (!flushed.ok) {
        setBanner({
          text: 'That peripheral could not be linked — see the message under Link Peripherals. '
            + 'Clear the box to save without it.',
          kind: 'error',
        });
        return;
      }
      toLink = flushed.items;
    }

    setSaving(true);
    try {
      const created = await createAsset(
        isAssets ? { ...values, linkedPeripheralIds: toLink.map((p) => p.id) } : values,
      );
      setBanner({
        text: `${meta.label.replace(/s$/, '')} "${created.assetTag || created.model}" `
          + `saved as ${created.assetId}.`
          + (created.verification === 'pending'
            ? ' It is waiting in Verification, and joins the register once another verifier '
              + 'has checked it. If it is sent back, correct it there and it is resubmitted.'
            : '')
          + (created.acceptedBySapId
            ? ' It has a SAP ID, so it went straight into the register without verification.'
            : '')
          + (created.linkedPeripheralsText
            ? ` Linked ${created.linkedPeripherals.length} peripheral(s): `
              + `${created.linkedPeripheralsText}.`
            : '')
          + (created.linkWarning ? ` ${created.linkWarning}` : ''),
        kind: created.linkWarning ? 'info' : 'success',
      });
      resetForm();
      notifyVerificationChanged();
    } catch (err) {
      setBanner({ text: errorMessage(err, `Could not save this ${meta.one}.`), kind: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-scroll entry-page">
      <div className="page-header entry-header">
        <div>
          <h1>Data Entry</h1>
        </div>
        <RegisterToggle />
      </div>

      <div className={`entry-columns${isAdmin ? '' : ' entry-columns-single'}`}>
        <div className="panel entry-panel">
          <h2>Manual Entry</h2>
          <div className="panel-sub">Fields marked * are required.</div>

          <Banner banner={banner} onDismiss={() => setBanner(null)} />

          <form onSubmit={handleSubmit} noValidate>
            <AssetForm
              values={values}
              errors={errors}
              onChange={handleChange}
              idPrefix="entry"
              register={register}
              cloning={cloning}
              linked={linked}
              onLinkChange={isAssets ? setLinked : null}
              linkDisabled={saving}
              linkRef={linkRef}
            />
            <div className="form-actions">
              <button type="submit" className="btn-primary" disabled={saving}>
                {saving ? 'Saving…' : `Save ${meta.label.replace(/s$/, '')}`}
              </button>
              <button type="button" className="btn-secondary" onClick={resetForm}>
                Clear Form
              </button>
            </div>
          </form>
        </div>

        {isAdmin && <BulkUpload />}
      </div>

      {poReminder && (
        <PoReminderDialog label={poLabel} onContinue={save} onCancel={backToPo} />
      )}
    </div>
  );
};

export default DataEntryPage;
