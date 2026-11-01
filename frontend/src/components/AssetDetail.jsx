import { formatIfDate } from '../lib/dates';
import { columnsFor, groupsFor } from '../lib/schema';
import { useAssets } from '../context/AssetsContext';
import { NOT_RECORDED, isNotRecorded } from '../lib/notRecorded';
import { WARRANTY_LABELS, daysUntilExpiry, warrantyState } from '../lib/warranty';
import StatusBadge from './StatusBadge';
import './AssetDetail.css';

function warrantyNote(asset) {
  const state = warrantyState(asset);
  const days = daysUntilExpiry(asset);
  if (state === 'unknown') return { tone: 'muted', text: WARRANTY_LABELS.unknown };
  if (days < 0) {
    return { tone: 'bad', text: `Out of warranty — ended ${Math.abs(days)} day(s) ago` };
  }
  if (state === 'soon') return { tone: 'warn', text: `Warranty ends in ${days} day(s)` };
  return { tone: 'good', text: `In warranty — ${days} day(s) left` };
}

function renewalNote(asset) {
  const days = daysUntilExpiry(asset);
  if (days === null || days === undefined || Number.isNaN(days)) {
    return { tone: 'muted', text: 'No renewal date recorded' };
  }
  if (days < 0) return { tone: 'bad', text: `Renewal overdue — ${Math.abs(days)} day(s) ago` };
  if (days === 0) return { tone: 'warn', text: 'Renews today' };
  return { tone: days <= 30 ? 'warn' : 'good', text: `Renews in ${days} day(s)` };
}

const RUPEES = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
function showValue(asset, key) {
  if (key === 'price' && Number.isFinite(Number(asset.price))) return `₹ ${RUPEES.format(Number(asset.price))}`;
  return formatIfDate(asset[key]);
}

const AssetDetail = ({ asset, omit = [] }) => {
  const { register } = useAssets();
  if (!asset) return null;
  const reg = asset.register || register;
  const software = reg === 'software';
  const warranty = software ? renewalNote(asset) : warrantyNote(asset);
  const hidden = new Set(omit);

  return (
    <div className="asset-detail">
      <div className="asset-detail-head">
        <div className="asset-detail-identity">
          <div className="asset-detail-id">{asset.assetId}</div>
          <h2>{asset.assetTag || asset.model}</h2>
        </div>
        <div className="asset-detail-badges">
          <StatusBadge status={asset.status} />
          {asset.isDeleted && <span className="pill pill-bad">Deleted</span>}
          <span className={`pill pill-${warranty.tone}`}>{warranty.text}</span>
        </div>
      </div>

      {groupsFor(reg).map((group) => {
        const cols = columnsFor(reg)
          .filter((c) => c.group === group.key && !hidden.has(c.key));
        if (!cols.length) return null;
        return (
          <div className="asset-detail-group" key={group.key}>
            <h3>{group.label}</h3>
            <dl className="asset-detail-grid">
              {cols.map((col) => (
                <div className="asset-detail-field" key={col.key}>
                  <dt>{col.label}</dt>
                  <dd>
                    {col.key === 'status'
                      ? <StatusBadge status={asset.status} />
                      : (isNotRecorded(asset[col.key])
                        ? <span className="asset-detail-empty">{NOT_RECORDED}</span>
                        : showValue(asset, col.key))}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        );
      })}

      <div className="asset-detail-group">
        <h3>Record</h3>
        <dl className="asset-detail-grid">
          {!software && (
            <div className="asset-detail-field">
              <dt>Service tag</dt>
              <dd>{asset.serviceTag || <span className="asset-detail-empty">&mdash;</span>}</dd>
            </div>
          )}
          <div className="asset-detail-field">
            <dt>Added by</dt>
            <dd>{asset.createdBy || <span className="asset-detail-empty">&mdash;</span>}</dd>
          </div>
          <div className="asset-detail-field">
            <dt>Last changed by</dt>
            <dd>{asset.updatedBy || <span className="asset-detail-empty">&mdash;</span>}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
};

export default AssetDetail;
