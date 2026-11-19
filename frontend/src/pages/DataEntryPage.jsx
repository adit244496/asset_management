import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Copy } from 'lucide-react';
import { errorMessage } from '../api';
import AssetForm from '../components/AssetForm';
import Banner from '../components/Banner';
import BulkUpload from '../components/BulkUpload';
import PoReminderDialog from '../components/PoReminderDialog';
import RegisterToggle from '../components/RegisterToggle';
import { useAssets } from '../context/AssetsContext';
import { useAuth } from '../context/AuthContext';
import { ASSET, registerOf } from '../lib/registers';
import { cloneAsset, emptyAsset, validateAsset } from '../lib/schema';
import { notifyVerificationChanged } from '../lib/verification';
import './DataEntryPage.css';

const CLONE_HINT = 'Fill in what is blank — serial, name, description, who it is for, the '
  + 'warranty and assigned dates, and any peripherals. Everything else is pre-filled from it '
  + 'and can be changed.';

const DataEntryPage = () => {
  const {
    assets, createAsset, register, meta, setRegister,
  } = useAssets();
  const { isAdmin, isSuperadmin } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const cloneValues = location.state?.cloneValues;
  const cloneFrom = location.state?.cloneFrom;
  // Verification can clone a peripheral or software while another register
  // is selected; switch to it without wiping the pre-filled form.
  const cloneRegister = cloneValues && location.state?.cloneRegister;
  const switchingTo = useRef(cloneRegister && cloneRegister !== register ? cloneRegister : null);
  const formRegister = switchingTo.current || register;
  const isAssets = formRegister === ASSET;

  const [values, setValues] = useState(() => (cloneValues
    ? { ...emptyAsset(formRegister), ...cloneValues } : emptyAsset(formRegister)));
  const [errors, setErrors] = useState({});
  const [linked, setLinked] = useState([]);
  const linkRef = useRef(null);
  const [banner, setBanner] = useState(cloneValues
    ? {
      text: `Cloned${cloneFrom ? ` from ${cloneFrom}` : ''}. ${CLONE_HINT}`,
      kind: 'info',
      sticky: true,
    }
    : null);
  const [saving, setSaving] = useState(false);
  // Set while the "no PO number" reminder is open: { clone } says which
  // button was pressed.
  const [poReminder, setPoReminder] = useState(null);
  const poLabel = registerOf(formRegister).labels.poNo || 'PO No.';
  const one = registerOf(formRegister).label.replace(/s$/, '');

  useEffect(() => {
    if (cloneValues) {
      navigate(location.pathname, { replace: true, state: null });
    }
    if (switchingTo.current) setRegister(switchingTo.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const firstRegister = useRef(register);
  useEffect(() => {
    if (firstRegister.current === register) return;
    firstRegister.current = register;
    if (switchingTo.current === register) {
      switchingTo.current = null;
      return;
    }
    resetForm();
    setBanner(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [register]);

  const handleChange = (key, value) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  };

  const resetForm = () => {
    setValues(emptyAsset(formRegister));
    setErrors({});
    setLinked([]);
  };

  // `clone`: Submit & Clone -- save, then refill the form from the saved
  // record, ready for the next device of the same batch.
  const submit = async ({ clone = false } = {}) => {
    if (saving) return;
    const found = validateAsset(values, { register: assets, registerKey: formRegister });
    if (Object.keys(found).length) {
      setErrors(found);
      setBanner({ text: 'Please fix the highlighted fields before submitting.', kind: 'error' });
      return;
    }
    if (!String(values.poNo ?? '').trim()) {
      setPoReminder({ clone });
      return;
    }
    await save({ clone });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    submit();
  };

  const backToPo = () => {
    setPoReminder(null);
    setTimeout(() => {
      const box = document.getElementById('entry_poNo');
      box?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      box?.focus();
    }, 0);
  };

  const save = async ({ clone = false } = {}) => {
    setPoReminder(null);
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
        text: `${one} "${created.assetTag || created.model}" `
          + `saved as ${created.assetId}.`
          + (created.verification === 'pending'
            ? (isSuperadmin
              ? ' It is waiting in Verification, and joins the register once it is verified '
              + '— as superadmin you can verify it yourself there.'
              : ' It is waiting in Verification, and joins the register once another verifier '
              + 'has checked it. If it is sent back, correct it there and it is resubmitted.')
            : '')
          + (created.linkedPeripheralsText
            ? ` Linked ${created.linkedPeripherals.length} peripheral(s): `
            + `${created.linkedPeripheralsText}.`
            : '')
          + (created.linkWarning ? ` ${created.linkWarning}` : '')
          + (clone ? ` The form is filled in from ${created.assetId} for the next one. ${CLONE_HINT}` : ''),
        kind: created.linkWarning ? 'info' : 'success',
        sticky: clone || undefined,
      });
      if (clone) {
        setValues({ ...emptyAsset(formRegister), ...cloneAsset(created, formRegister) });
        setErrors({});
        setLinked([]);
        setTimeout(() => {
          const first = document.getElementById('entry_srl');
          first?.scrollIntoView({ block: 'center', behavior: 'smooth' });
          first?.focus({ preventScroll: true });
        }, 0);
      } else {
        resetForm();
      }
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
              register={formRegister}
              linked={linked}
              onLinkChange={isAssets ? setLinked : null}
              linkDisabled={saving}
              linkRef={linkRef}
            />
            <div className="form-actions">
              <button type="submit" className="btn-primary" disabled={saving}>
                {saving ? 'Saving…' : `Save ${one}`}
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={saving}
                onClick={() => submit({ clone: true })}
                title={`Save this ${registerOf(formRegister).one}, then fill the form in from it for the `
                  + 'next one of the same batch'}
              >
                <Copy size={14} /> Submit &amp; Clone
              </button>
              <button type="button" className="btn-secondary" onClick={resetForm} disabled={saving}>
                Clear Form
              </button>
            </div>
          </form>
        </div>

        {isAdmin && <BulkUpload />}
      </div>

      {poReminder && (
        <PoReminderDialog
          label={poLabel}
          onContinue={() => save({ clone: poReminder.clone })}
          onCancel={backToPo}
        />
      )}
    </div>
  );
};

export default DataEntryPage;
