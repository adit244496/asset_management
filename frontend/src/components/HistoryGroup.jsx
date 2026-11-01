import {
  ArrowRight, ChevronDown, ChevronRight, CircleDot, Link2, MapPin, Pencil, Plus,
  RotateCcw, Trash2, Upload, User,
} from 'lucide-react';
import { formatDateTime, formatIfDate } from '../lib/dates';
import {
  composedChange, fieldLabel, groupHeadline, groupLead, isExpandable,
} from '../lib/historyGroups';
import './AssetHistory.css';

const ICONS = {
  moved: MapPin,
  reassigned: User,
  status: CircleDot,
  linked: Link2,
  updated: Pencil,
  created: Plus,
  imported: Upload,
  deleted: Trash2,
  restored: RotateCcw,
};

const KINDS_NAMING_THEIR_FIELD = new Set(['moved', 'reassigned', 'status']);

const formatWhen = formatDateTime;

const Value = ({ children }) => (
  children ? <span className="hist-value">{formatIfDate(children)}</span>
    : <span className="hist-value hist-value-empty">empty</span>
);

const Change = ({ event, dense }) => (
  <span className={dense ? 'hist-change-inline' : 'hist-change'}>
    <Value>{event.oldValue}</Value>
    <ArrowRight size={dense ? 11 : 12} className="hist-arrow" />
    <Value>{event.newValue}</Value>
  </span>
);

const HistoryGroup = ({
  group, register, assetNumber, dense = false, open = false, onToggle,
}) => {
  const Icon = ICONS[group.kind] || Pencil;
  const headline = groupHeadline(group);
  const expandable = isExpandable(group);
  const lead = groupLead(group);
  const rest = group.events.length - 1;

  const namesItsField = KINDS_NAMING_THEIR_FIELD.has(group.kind);
  const showLeadLabel = Boolean(lead?.field) && !namesItsField;

  const composed = composedChange(group);

  const summary = composed ? (
    <>
      <strong>{headline}</strong>
      <span className={dense ? 'hist-change-inline' : 'hist-change'}>
        <Value>{composed.from}</Value>
        <ArrowRight size={dense ? 11 : 12} className="hist-arrow" />
        <Value>{composed.to}</Value>
      </span>
    </>
  ) : (
    <>
      <strong>{headline}</strong>
      {lead?.field && showLeadLabel && (
        <span className="hist-lead-field">{fieldLabel(lead.field, register)}</span>
      )}
      {lead && (lead.field || lead.oldValue || lead.newValue) && (
        <Change event={lead} dense={dense || expandable} />
      )}
      {expandable && <span className="hist-more">+{rest} more</span>}
    </>
  );

  return (
    <li className={`hist-row hist-${group.kind} hist-${group.action}`}>
      <span className="hist-icon"><Icon size={13} /></span>
      <div className="hist-body">
        {expandable ? (
          <button
            type="button"
            className="hist-head hist-head-btn"
            aria-expanded={open}
            onClick={onToggle}
          >
            <span className="hist-chevron" aria-hidden="true">
              {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </span>
            <span className="hist-what">{summary}</span>
          </button>
        ) : (
          <div className="hist-head">
            <span className="hist-chevron" aria-hidden="true" />
            <span className="hist-what">{summary}</span>
          </div>
        )}

        {expandable && open && (
          <ul className="hist-fields">
            {group.events.map((e) => (
              <li key={e.id}>
                <span className="hist-field-name">{fieldLabel(e.field, register)}</span>
                <Change event={e} dense={dense} />
              </li>
            ))}
          </ul>
        )}

        <div className="hist-meta">
          {formatWhen(group.at)}
          {group.actor && <> · {group.actor}</>}
          {group.events[0]?.assetId && assetNumber
            && group.events[0].assetId !== assetNumber && (
            <> · recorded as {group.events[0].assetId}</>
          )}
        </div>
      </div>
    </li>
  );
};

export default HistoryGroup;
