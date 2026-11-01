import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, X } from 'lucide-react';
import api, { errorMessage } from '../api';
import { useAssets } from '../context/AssetsContext';
import { sameLocation, splitByLocation } from '../lib/people';
import { SEED_OPTIONS } from '../lib/schema';
import PersonPicker from './PersonPicker';
import './TransferModal.css';

const IN_USE = /^in[\s_-]*use$/i;
const movesOntoAsset = (record) =>
  record?.register === 'peripheral' && IN_USE.test((record?.status || '').trim());

const ASSET_MATCH_LIMIT = 40;

const TransferModal = ({
  record, noun = 'asset', canAssign = true, assign = false, onClose, onDone,
}) => {
  const { optionsFor, formOptionsFor, refresh, assets: registerItems } = useAssets();

  const [location, setLocation] = useState(record?.location || '');
  const [floor, setFloor] = useState(record?.floor || '');
  const [userId, setUserId] = useState('');
  const [name, setName] = useState(record?.assetTag || '');
  const [showEveryone, setShowEveryone] = useState(false);
  const [people, setPeople] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [filled, setFilled] = useState(null);

  const ontoAsset = movesOntoAsset(record);
  const [assets, setAssets] = useState(null);
  const [assetQuery, setAssetQuery] = useState('');
  const [ontoId, setOntoId] = useState('');

  useEffect(() => {
    if (ontoAsset) return undefined;
    let cancelled = false;
    api.get('/users')
      .then((res) => { if (!cancelled) setPeople(res.data || []); })
      .catch((err) => {
        if (!cancelled) {
          setPeople([]);
          setError(errorMessage(err, 'Could not load the list of people.'));
        }
      });
    return () => { cancelled = true; };
  }, [ontoAsset]);

  useEffect(() => {
    if (!ontoAsset) return undefined;
    let cancelled = false;
    api.get('/assets')
      .then((res) => { if (!cancelled) setAssets(res.data?.items || []); })
      .catch((err) => {
        if (!cancelled) {
          setAssets([]);
          setError(errorMessage(err, 'Could not load the list of assets.'));
        }
      });
    return () => { cancelled = true; };
  }, [ontoAsset]);

  const withValue = (list, value) => (
    value && !list.some((v) => sameLocation(v, value)) ? [...list, value] : list);
  const locations = withValue(formOptionsFor('location', record?.location), location);
  const masterFloors = formOptionsFor('floor', record?.floor);
  const floors = withValue(masterFloors.length ? masterFloors
    : (optionsFor('floor').length ? optionsFor('floor') : SEED_OPTIONS.floor), floor);

  const pickPerson = (person) => {
    setUserId(person ? person.id : '');
    if (!person || !person.location) {
      setFilled(null);
      return;
    }
    const place = locations.find((v) => sameLocation(v, person.location)) || person.location;
    const who = (person.fullName || '').trim().toLowerCase();
    const theirs = (registerItems || [])
      .filter((a) => a.id !== record.id && !a.isDeleted && a.floor
        && (a.user || '').trim().toLowerCase() === who && sameLocation(a.location, place))
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    const nextFloor = theirs.length ? theirs[0].floor : (sameLocation(place, location) ? floor : '');
    setLocation(place);
    setFloor(nextFloor);
    setFilled({ name: person.fullName || person.username, location: place,
      floor: theirs.length ? theirs[0].floor : null });
  };

  const split = useMemo(() => splitByLocation(people, location), [people, location]);
  const { here, unknown, elsewhere } = split;

  const offered = useMemo(
    () => (showEveryone ? [...here, ...unknown, ...elsewhere] : [...here, ...unknown]),
    [showEveryone, here, unknown, elsewhere],
  );

  const chosen = (people || []).find((p) => p.id === userId && p.isActive) || null;
  const selectedId = chosen ? chosen.id : '';

  const assetMatches = useMemo(() => {
    const all = (assets || []).filter((a) => !a.isDeleted);
    const q = assetQuery.trim().toLowerCase();
    const hit = (a) => !q || [a.assetId, a.assetTag, a.srl, a.serviceTag, a.user, a.model]
      .some((v) => (v || '').toString().toLowerCase().includes(q));
    return all.filter(hit);
  }, [assets, assetQuery]);

  const shownAssets = assetMatches.slice(0, ASSET_MATCH_LIMIT);
  const onto = shownAssets.find((a) => a.id === ontoId) || null;
  const ontoSelectedId = onto ? onto.id : '';
  const movingElsewhere = Boolean(chosen?.location && !sameLocation(chosen.location, location));

  const path = `/${record.register === 'peripheral' ? 'peripherals' : 'assets'}/${encodeURIComponent(record.id)}/transfer`;

  const handleTransfer = async () => {
    if (ontoAsset && !ontoSelectedId) {
      setError('Choose the asset it is being plugged into.');
      return;
    }
    if (!ontoAsset && !location.trim()) {
      setError('Choose where it is going.');
      return;
    }
    if (assign && !selectedId) {
      setError('Choose who it is being assigned to.');
      return;
    }
    if (assign && !name.trim()) {
      setError('Give it a name — its old one was cleared when it went into stock.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (ontoAsset) {
        await api.post(path, { assetId: ontoSelectedId });
        await refresh();
        onDone(`${record.assetId} is now on ${onto.assetId}${onto.assetTag ? ` (${onto.assetTag})` : ''}, at ${onto.location || 'its location'}.`);
        return;
      }

      const body = { location: location.trim(), floor };
      if (assign) body.assetTag = name.trim();
      if (canAssign && selectedId) {
        body.userId = selectedId;
        if (movingElsewhere) body.allowElsewhere = true;
      }
      await api.post(path, body);
      await refresh();
      if (assign) {
        onDone(`${record.assetId} assigned to ${chosen.fullName || chosen.username} as `
          + `${name.trim()}, at ${location.trim()}.`);
        return;
      }
      onDone(chosen
        ? `${record.assetId} moved to ${location.trim()} and assigned to ${chosen.fullName || chosen.username}.`
        : `${record.assetId} moved to ${location.trim()}.`);
    } catch (err) {
      setError(errorMessage(err, `Could not ${assign ? 'assign' : 'transfer'} this ${noun}.`));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal modal-narrow">
        <div className="modal-head">
          <h2>{assign ? 'Assign' : 'Transfer'} {record?.assetId}</h2>
          <button type="button" className="modal-close" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          {error && <div className="banner banner-error">{error}</div>}

          <div className="transfer-from">
            <span className="transfer-from-label">Currently</span>
            <span className="transfer-from-value">
              {record?.location || '—'}
              {record?.floor ? ` (${record.floor})` : ''}
              {canAssign && record?.user ? ` · ${record.user}` : ''}
            </span>
          </div>

          {ontoAsset && (
            <>
              <p className="transfer-mode-note">
                This {noun} is <strong>in use</strong>, so it moves onto an asset.
                Its location follows whatever it is plugged into.
              </p>

              <div className="field">
                <label htmlFor="transferAssetQuery">Find the asset</label>
                <input
                  id="transferAssetQuery"
                  className="field-input"
                  type="text"
                  autoComplete="off"
                  placeholder="Asset ID, computer name, serial or holder&hellip;"
                  value={assetQuery}
                  onChange={(e) => setAssetQuery(e.target.value)}
                />
              </div>

              <div className="field">
                <label htmlFor="transferOnto">Plug into *</label>
                <select
                  id="transferOnto"
                  className="field-input"
                  value={ontoSelectedId}
                  onChange={(e) => setOntoId(e.target.value)}
                  disabled={assets === null}
                  size={Math.min(Math.max(shownAssets.length, 2), 8)}
                >
                  {shownAssets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {[a.assetId, a.assetTag, a.user, a.location].filter(Boolean).join(' · ')}
                    </option>
                  ))}
                </select>
                <p className="field-hint">
                  {assets === null
                    ? 'Loading assets…'
                    : `${assetMatches.length.toLocaleString('en-IN')} asset(s) match` +
                      (assetMatches.length > ASSET_MATCH_LIMIT
                        ? ` — showing the first ${ASSET_MATCH_LIMIT}. Type to narrow.`
                        : '.')}
                </p>
              </div>

              {onto && (
                <div className="transfer-summary">
                  <span>{record?.location || '—'}</span>
                  <ArrowRight size={14} />
                  <span>
                    on <strong>{onto.assetId}</strong>
                    {onto.location ? ` at ${onto.location}` : ''}
                    {onto.floor ? ` (${onto.floor})` : ''}
                  </span>
                </div>
              )}
            </>
          )}

          {!ontoAsset && (
          <>
          <div className="field">
            <label htmlFor="transferLocation">{assign ? 'Location *' : 'Move to *'}</label>
            <select
              id="transferLocation"
              className="field-input"
              value={location}
              onChange={(e) => { setLocation(e.target.value); setUserId(''); setFilled(null); }}
            >
              <option value="">Choose a location&hellip;</option>
              {locations.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>

          <div className="field">
            <label htmlFor="transferFloor">Floor</label>
            <select
              id="transferFloor"
              className="field-input"
              value={floor}
              onChange={(e) => { setFloor(e.target.value); setFilled(null); }}
            >
              <option value="">&mdash;</option>
              {floors.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>

          {canAssign && (
            <div className="field">
              <label htmlFor="transferUser">Assign to{assign ? ' *' : ''}</label>
              <PersonPicker
                id="transferUser"
                offered={offered}
                elsewhere={showEveryone ? [] : elsewhere}
                selected={chosen}
                onPick={pickPerson}
                disabled={!location}
                loading={people === null}
                placeholder={!location ? 'Choose a location first'
                  : assign ? 'Type a name to find them…'
                    : 'Leave with the current holder — or type a name'}
              />

              {people !== null && location && (
                <p className="field-hint">
                  {here.length === 0
                    ? `Nobody is recorded at ${location}.`
                    : `${here.length} ${here.length === 1 ? 'person is' : 'people are'} recorded at ${location}`}
                  {unknown.length > 0 && `, and ${unknown.length} with no location on file`}.
                  {' '}
                  <button
                    type="button"
                    className="transfer-widen"
                    onClick={() => setShowEveryone((v) => !v)}
                  >
                    {showEveryone
                      ? 'Show only people here'
                      : `Show everyone else (${elsewhere.length})`}
                  </button>
                </p>
              )}

              {filled && chosen && (
                <p className="transfer-filled">
                  Location{filled.floor ? ' and floor' : ''} filled in from {filled.name}&rsquo;s record
                  {filled.floor ? '' : ' — no floor on file for them there, so choose it'}.
                </p>
              )}

              {movingElsewhere && (
                <p className="transfer-warning">
                  {chosen.fullName || chosen.username} is recorded at{' '}
                  <strong>{chosen.location}</strong>, not {location}. Transferring
                  anyway will leave their own record unchanged.
                </p>
              )}
            </div>
          )}

          {assign && (
            <div className="field">
              <label htmlFor="transferName">Computer / Asset Name *</label>
              <input
                id="transferName"
                className="field-input"
                type="text"
                autoComplete="off"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="The name it goes out under"
              />
              <p className="field-hint">
                {record?.assetTag
                  ? 'Keep the name it has, or rename it for its new holder.'
                  : 'Its old name was cleared when it went into stock.'}
              </p>
            </div>
          )}

          {location && !assign && (
            <div className="transfer-summary">
              <span>{record?.location || '—'}</span>
              <ArrowRight size={14} />
              <span><strong>{location}</strong>{floor ? ` (${floor})` : ''}</span>
            </div>
          )}
          </>
          )}
        </div>

        <div className="modal-foot">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="btn-primary"
            onClick={handleTransfer}
            disabled={saving || (ontoAsset ? !ontoSelectedId : !location)
              || (assign && (!selectedId || !name.trim()))}
          >
            {assign ? (saving ? 'Assigning…' : 'Assign') : (saving ? 'Transferring…' : 'Transfer')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default TransferModal;
