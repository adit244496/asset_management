import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowDownToLine, ArrowLeft, ArrowRightLeft, History, Link2, Pencil, QrCode, Tag, UserPlus,
} from 'lucide-react';
import { errorMessage } from '../api';
import AssetDetail from '../components/AssetDetail';
import AssetModal from '../components/AssetModal';
import Banner from '../components/Banner';
import QrCodesModal from '../components/QrCodesModal';
import SellModal from '../components/SellModal';
import SoftwareMoveModal from '../components/SoftwareMoveModal';
import TransferModal from '../components/TransferModal';
import { useAssets } from '../context/AssetsContext';
import { useAuth } from '../context/AuthContext';
import { isInStock } from '../lib/inventory';
import { ASSET, PERIPHERAL, SOFTWARE, isRegisterKey, registerOf } from '../lib/registers';
import './RecordPage.css';

const RecordPage = () => {
  const { register: registerParam, id } = useParams();
  const { fetchRecord, setRegister } = useAssets();
  const { canWrite, canEdit } = useAuth();

  const register = isRegisterKey(registerParam) ? registerParam : ASSET;
  const meta = registerOf(register);

  const [record, setRecord] = useState(null);
  const [error, setError] = useState('');
  const [banner, setBanner] = useState(null);
  const [editing, setEditing] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [selling, setSelling] = useState(false);
  const [moving, setMoving] = useState(null);
  const [qrIds, setQrIds] = useState(null);

  const load = useCallback(async () => {
    try {
      setRecord(await fetchRecord(id, register));
      setError('');
    } catch (err) {
      setError(errorMessage(err, `Could not load this ${registerOf(register).one}.`));
    }
  }, [fetchRecord, id, register]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => { setRegister(register); }, [register, setRegister]);

  const spare = register === ASSET && isInStock(record?.status);
  const sellable = register === ASSET && record && !record.isDeleted && !record.pendingApproval
    && !/sold/i.test(String(record.status || ''));

  const linked = register === ASSET
    ? (record?.linkedPeripherals || [])
    : (record?.linkedAssets || []);
  const linkedRegister = register === ASSET ? PERIPHERAL : ASSET;

  if (error) {
    return (
      <div className="page-scroll">
        <Link className="record-back" to="/report"><ArrowLeft size={14} /> Report Section</Link>
        <div className="banner banner-error">{error}</div>
      </div>
    );
  }

  if (!record || record.id !== id) {
    return <div className="page-scroll"><div className="loading-note">Loading&hellip;</div></div>;
  }

  return (
    <div className="page-scroll record-page">
      <div className="record-bar">
        <Link className="record-back" to="/report">
          <ArrowLeft size={14} /> {meta.label}
        </Link>
        <div className="record-actions">
          {canWrite && register === SOFTWARE && !record.isDeleted && !record.pendingApproval
            && !/sold/i.test(String(record.status || '')) && (isInStock(record.status) ? (
            <button type="button" className="btn-primary" onClick={() => setMoving('assign')}>
              <UserPlus size={14} /> Assign
            </button>
          ) : (
            <button type="button" className="btn-primary" onClick={() => setMoving('stock')}>
              <ArrowDownToLine size={14} /> Move to stock
            </button>
          ))}
          {canWrite && register !== SOFTWARE && (spare ? (
            <button type="button" className="btn-primary" onClick={() => setTransferring(true)}>
              <UserPlus size={14} /> Assign
            </button>
          ) : (
            <button type="button" className="btn-primary" onClick={() => setTransferring(true)}>
              <ArrowRightLeft size={14} /> Transfer
            </button>
          ))}
          {canEdit && (
            <button type="button" className="btn-secondary" onClick={() => setEditing(true)}>
              <Pencil size={14} /> Edit
            </button>
          )}
          {canWrite && sellable && (
            <button type="button" className="btn-secondary" onClick={() => setSelling(true)}>
              <Tag size={14} /> Sell
            </button>
          )}
          <button type="button" className="btn-secondary" onClick={() => setQrIds([record.id])}>
            <QrCode size={14} /> QR label
          </button>
          <Link className="btn-secondary record-trail-link" to={`/history/${encodeURIComponent(record.id)}`}>
            <History size={14} /> Full trail
          </Link>
        </div>
      </div>

      <Banner banner={banner} onDismiss={() => setBanner(null)} />

      <div className="panel">
        <AssetDetail
          asset={record}
          omit={['linkedPeripheralsText', 'linkedAssetText']}
        />
      </div>

      {register !== SOFTWARE && (
      <div className="panel record-linked">
        <h2>
          <Link2 size={15} />
          {register === ASSET ? 'Linked peripherals' : 'Linked to'}
          <span className="record-linked-count">{linked.length}</span>
        </h2>
        {linked.length === 0 ? (
          <div className="record-linked-empty">
            {register === ASSET
              ? 'Nothing plugged into this asset yet. Scan a mouse, keyboard or dock '
                + 'into Link Peripherals when you edit it.'
              : 'This peripheral is not linked to an asset. Link it from the asset’s '
                + 'own record.'}
          </div>
        ) : (
          <ul className="record-chips">
            {linked.map((item) => (
              <li key={item.id}>
                <Link
                  className="record-chip"
                  to={`/report/${linkedRegister}/${encodeURIComponent(item.id)}`}
                >
                  <span className="record-chip-id">{item.assetId}</span>
                  <span className="record-chip-name">
                    {item.label || item.assetTag || item.model}
                  </span>
                  <span className="record-chip-meta">
                    {[item.type, item.model].filter(Boolean).join(' · ')}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      )}

      {editing && (
        <AssetModal
          asset={record}
          highlightLink={register === ASSET}
          onClose={() => { setEditing(false); load(); }}
        />
      )}

      {transferring && (
        <TransferModal
          record={record}
          noun={meta.one}
          canAssign={register === ASSET}
          assign={spare}
          onClose={() => setTransferring(false)}
          onDone={(text) => {
            setTransferring(false);
            setBanner({ text, kind: 'success' });
            load();
          }}
        />
      )}

      {selling && (
        <SellModal
          record={record}
          onClose={() => setSelling(false)}
          onDone={(text, kind) => {
            setSelling(false);
            setBanner({ text, kind });
            load();
          }}
        />
      )}

      {moving && (
        <SoftwareMoveModal
          record={record}
          action={moving}
          onClose={() => setMoving(null)}
          onDone={(text) => {
            setMoving(null);
            setBanner({ text, kind: 'success' });
            load();
          }}
        />
      )}

      {qrIds && <QrCodesModal ids={qrIds} onClose={() => setQrIds(null)} />}
    </div>
  );
};

export default RecordPage;
