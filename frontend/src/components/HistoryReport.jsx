import { formatDateTime, formatIfDate } from '../lib/dates';
import { composedChange, fieldLabel, groupHeadline } from '../lib/historyGroups';
import './HistoryReport.css';

const formatWhen = formatDateTime;

const val = (v) => {
  const clean = (v ?? '').toString().trim();
  return clean ? formatIfDate(clean) : '—';
};

function linesFor(group, register) {
  const composed = composedChange(group);
  if (composed) return [{ label: '', from: composed.from, to: composed.to }];
  return group.events.map((e) => ({
    label: e.field ? fieldLabel(e.field, register) : '',
    from: e.oldValue,
    to: e.newValue,
  }));
}

const HistoryReport = ({ asset, groups, events, register, generatedBy }) => {
  if (!asset) return null;

  const oldest = groups.length ? groups[groups.length - 1].at : null;
  const newest = groups.length ? groups[0].at : null;

  return (
    <div className="hist-report" role="document" aria-hidden="true">
      <header className="hist-report-head">
        <div>
          <div className="hist-report-kicker">IT Asset Engine · AmbujaNeotia</div>
          <h1>Asset history</h1>
        </div>
        <div className="hist-report-id">{asset.assetId}</div>
      </header>

      <table className="hist-report-facts">
        <tbody>
          <tr>
            <th>Name</th><td>{val(asset.assetTag)}</td>
            <th>Serial</th><td>{val(asset.srl)}</td>
          </tr>
          <tr>
            <th>Model</th><td>{val(asset.model)}</td>
            <th>Status</th><td>{val(asset.status)}</td>
          </tr>
          <tr>
            <th>Assigned to</th><td>{val(asset.user)}</td>
            <th>Department</th><td>{val(asset.department)}</td>
          </tr>
          <tr>
            <th>Location</th>
            <td>{[asset.location, asset.floor].filter(Boolean).join(' · ') || '—'}</td>
            <th>Company</th><td>{val(asset.company)}</td>
          </tr>
        </tbody>
      </table>

      <p className="hist-report-summary">
        {groups.length.toLocaleString('en-IN')} entr{groups.length === 1 ? 'y' : 'ies'}
        {groups.length !== events.length && (
          <> from {events.length.toLocaleString('en-IN')} recorded changes</>
        )}
        {oldest && newest && (
          <>, {formatWhen(oldest)} to {formatWhen(newest)}</>
        )}
        . Newest first.
      </p>

      {!groups.length ? (
        <p className="hist-report-empty">
          Nothing recorded for this asset. History starts from the first change
          after this feature was added, so an asset untouched since then shows
          nothing here.
        </p>
      ) : (
        <table className="hist-report-table">
          <thead>
            <tr>
              <th className="c-when">When</th>
              <th className="c-what">What happened</th>
              <th className="c-field">Field</th>
              <th className="c-from">From</th>
              <th className="c-to">To</th>
              <th className="c-who">By</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => {
              const lines = linesFor(group, register);
              return lines.map((line, i) => (
                <tr
                  key={`${group.id}-${i}`}
                  className={`${i === 0 ? 'hist-report-first' : 'hist-report-cont'}`}
                >
                  <td className="c-when">{i === 0 ? formatWhen(group.at) : ''}</td>
                  <td className="c-what">{i === 0 ? groupHeadline(group) : ''}</td>
                  <td className="c-field">{line.label}</td>
                  <td className="c-from">{val(line.from)}</td>
                  <td className="c-to">{val(line.to)}</td>
                  <td className="c-who">{i === 0 ? val(group.actor) : ''}</td>
                </tr>
              ));
            })}
          </tbody>
        </table>
      )}

      <footer className="hist-report-foot">
        Generated {formatWhen(new Date().toISOString())}
        {generatedBy ? ` by ${generatedBy}` : ''} from IT Asset Engine.
        {' '}History is recorded from the first change after auditing was
        added; anything before that is not in this report.
      </footer>
    </div>
  );
};

export default HistoryReport;
