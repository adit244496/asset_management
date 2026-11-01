import {
  categoryLabel, changeText, dash, formatWhen, outcomeLabel, subjectOf,
} from '../lib/activity';
import './ActivityReport.css';

const ActivityReport = ({ items, total, filterSummary, generatedBy }) => {
  const rows = items || [];
  const newest = rows.length ? rows[0].at : null;
  const oldest = rows.length ? rows[rows.length - 1].at : null;
  const truncated = typeof total === 'number' && total > rows.length;

  return (
    <div className="act-report" role="document" aria-hidden="true">
      <header className="act-report-head">
        <div>
          <div className="act-report-kicker">IT Asset Engine · AmbujaNeotia</div>
          <h1>Activity log</h1>
        </div>
        <div className="act-report-count">
          {rows.length.toLocaleString('en-IN')} entr{rows.length === 1 ? 'y' : 'ies'}
        </div>
      </header>

      <table className="act-report-facts">
        <tbody>
          <tr>
            <th>Filters</th>
            <td colSpan={3}>{filterSummary || 'no filters — the complete log'}</td>
          </tr>
          <tr>
            <th>Period</th>
            <td>
              {oldest && newest ? `${formatWhen(oldest)} to ${formatWhen(newest)}` : '—'}
            </td>
            <th>Entries</th>
            <td>
              {rows.length.toLocaleString('en-IN')}
              {truncated && ` of ${total.toLocaleString('en-IN')} — THIS IS NOT THE FULL SET`}
            </td>
          </tr>
        </tbody>
      </table>

      {!rows.length ? (
        <p className="act-report-empty">
          No activity matches these filters.
        </p>
      ) : (
        <table className="act-report-table">
          <thead>
            <tr>
              <th className="c-when">When</th>
              <th className="c-who">Who</th>
              <th className="c-area">Area</th>
              <th className="c-what">What happened</th>
              <th className="c-outcome">Outcome</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={`${row.at}-${i}`}
                className={row.outcome === 'ok' ? '' : 'act-report-notable'}
              >
                <td className="c-when">{formatWhen(row.at)}</td>
                <td className="c-who">{dash(row.actor)}</td>
                <td className="c-area">{categoryLabel(row.category)}</td>
                <td className="c-what">
                  {[subjectOf(row), changeText(row)].filter(Boolean).join(' · ')}
                </td>
                <td className="c-outcome">{outcomeLabel(row.outcome)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <footer className="act-report-foot">
        Generated {formatWhen(new Date().toISOString())}
        {generatedBy ? ` by ${generatedBy}` : ''} from IT Asset Engine.
        {' '}A profile marked “(current)” is the account’s profile today, not
        necessarily the one it held when it acted — register changes were
        recorded before profiles were.
        {' '}Activity is recorded from the first action after logging was
        added; anything before that is not in this report.
      </footer>
    </div>
  );
};

export default ActivityReport;
