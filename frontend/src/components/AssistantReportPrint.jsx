import { createPortal } from 'react-dom';
import { formatDateTime, formatIfDate } from '../lib/dates';
import { registerOf } from '../lib/registers';
import './AssistantReportPrint.css';

const AssistantReportPrint = ({ report }) => {
  if (!report) return null;
  const { title, description, register, rows, columns, generatedBy } = report;
  const meta = registerOf(register);
  const count = rows.length;

  return createPortal(
    <div className="asst-report" role="document" aria-hidden="true">
      <header className="asst-report-head">
        <div>
          <div className="asst-report-kicker">IT Asset Engine · AmbujaNeotia</div>
          <h1>{title || `Report of ${meta.many}`}</h1>
        </div>
        <div className="asst-report-count">
          {count.toLocaleString('en-IN')} {count === 1 ? meta.one : meta.many}
        </div>
      </header>

      <table className="asst-report-facts">
        <tbody>
          <tr>
            <th>Register</th>
            <td>{meta.label}</td>
          </tr>
          <tr>
            <th>Filters</th>
            <td>{description || 'none'}</td>
          </tr>
        </tbody>
      </table>

      <table className="asst-report-table">
        <thead>
          <tr>{columns.map((col) => <th key={col.key}>{col.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              {columns.map((col) => <td key={col.key}>{formatIfDate(row[col.key]) || '—'}</td>)}
            </tr>
          ))}
        </tbody>
      </table>

      <footer className="asst-report-foot">
        Generated {formatDateTime(new Date())}
        {generatedBy ? ` by ${generatedBy}` : ''} from IT Asset Engine&rsquo;s assistant.
        {' '}Lists the register as it stood at that moment; entries still waiting in
        Verification are not included.
      </footer>
    </div>,
    document.body,
  );
};

export default AssistantReportPrint;
