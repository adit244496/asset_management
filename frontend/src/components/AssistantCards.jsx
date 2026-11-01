import {
  AlertTriangle, CheckCircle2, ExternalLink, FileSpreadsheet, FileText, QrCode, Sheet, ShieldCheck,
} from 'lucide-react';
import { QR_LIMIT, tableCell } from '../lib/assistantReports';
import { registerOf } from '../lib/registers';

const busyLabel = (busy, id, use, label) => (busy === `${id}:${use}` ? 'Preparing…' : label);

export const ReportCard = ({ item, busy, onRun }) => {
  const meta = registerOf(item.register);
  const disabled = Boolean(busy);
  const qrNote = item.count > QR_LIMIT ? ` (first ${QR_LIMIT})` : '';
  return (
    <div className="asst-card asst-card-report">
      <div className="asst-card-head">
        <FileSpreadsheet size={15} className="asst-card-icon" />
        <div className="asst-card-titles">
          <div className="asst-card-title">{item.title}</div>
          <div className="asst-card-sub">
            {item.count.toLocaleString('en-IN')} {item.count === 1 ? meta.one : meta.many}
            {' '}when made · {item.description}
          </div>
        </div>
      </div>
      <div className="asst-card-actions">
        <button type="button" className="asst-chip" disabled={disabled} onClick={() => onRun(item, 'excel')}>
          <Sheet size={13} /> {busyLabel(busy, item.id, 'excel', 'Excel')}
        </button>
        <button type="button" className="asst-chip" disabled={disabled} onClick={() => onRun(item, 'csv')}>
          <FileText size={13} /> {busyLabel(busy, item.id, 'csv', 'CSV')}
        </button>
        <button type="button" className="asst-chip" disabled={disabled} onClick={() => onRun(item, 'pdf')}
          title="Opens the print dialog -- choose Save as PDF">
          <FileText size={13} /> {busyLabel(busy, item.id, 'pdf', 'PDF')}
        </button>
        <button type="button" className="asst-chip" disabled={disabled} onClick={() => onRun(item, 'open')}>
          <ExternalLink size={13} /> {busyLabel(busy, item.id, 'open', 'Open in Report')}
        </button>
        <button type="button" className="asst-chip" disabled={disabled} onClick={() => onRun(item, 'qr')}>
          <QrCode size={13} /> {busyLabel(busy, item.id, 'qr', `QR labels${qrNote}`)}
        </button>
      </div>
    </div>
  );
};

export const TableCard = ({ item, busy, onDownloadTable }) => (
  <div className="asst-card asst-card-table">
    <div className="asst-card-head">
      <Sheet size={15} className="asst-card-icon" />
      <div className="asst-card-titles">
        <div className="asst-card-title">{item.title}</div>
        {item.description && <div className="asst-card-sub">{item.description}</div>}
      </div>
    </div>
    <div className="asst-table-wrap">
      <table className="asst-table">
        <thead>
          <tr>{item.header.map((h, i) => <th key={`${h}-${i}`}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {item.rows.map((row, r) => (
            <tr key={`${row[0]}-${r}`}>
              {row.map((cell, i) => <td key={i}>{i === 0 ? cell : tableCell(cell)}</td>)}
            </tr>
          ))}
        </tbody>
        {item.footer && (
          <tfoot>
            <tr>{item.footer.map((cell, i) => <td key={i}>{i === 0 ? cell : tableCell(cell)}</td>)}</tr>
          </tfoot>
        )}
      </table>
    </div>
    {item.more > 0 && (
      <div className="asst-card-sub">
        {item.more} more {item.more === 1 ? 'group' : 'groups'} not shown, smallest first.
      </div>
    )}
    <div className="asst-card-actions">
      <button type="button" className="asst-chip" disabled={Boolean(busy)} onClick={() => onDownloadTable(item)}>
        <Sheet size={13} /> {busyLabel(busy, item.id, 'table', 'Excel')}
      </button>
    </div>
  </div>
);

export const AttentionCard = ({ item, busy, onRun, onOpenRecord, onOpenVerification }) => {
  const waiting = item.verification;
  const waitingCount = waiting ? waiting.pending + waiting.rejected : 0;
  const nothing = !item.items.length && !waitingCount;
  return (
    <div className="asst-card asst-card-attention">
      <div className="asst-card-head">
        {nothing
          ? <CheckCircle2 size={15} className="asst-card-icon is-ok" />
          : <AlertTriangle size={15} className="asst-card-icon is-warn" />}
        <div className="asst-card-titles">
          <div className="asst-card-title">{item.title}</div>
          <div className="asst-card-sub">
            {nothing ? 'Nothing needs attention right now.' : `“Ending soon” means within ${item.days} days.`}
          </div>
        </div>
      </div>

      {waitingCount > 0 && (
        <div className="asst-finding">
          <div className="asst-finding-line">
            <ShieldCheck size={13} />
            <span className="asst-finding-label">Waiting in Verification</span>
            <span className="asst-finding-count">{waitingCount}</span>
          </div>
          <div className="asst-finding-detail">
            {waiting.pending} pending{waiting.rejected ? `, ${waiting.rejected} sent back` : ''}
          </div>
          <div className="asst-card-actions">
            <button type="button" className="asst-chip" onClick={onOpenVerification}>
              <ExternalLink size={13} /> Open Verification
            </button>
          </div>
        </div>
      )}

      {item.items.map((f) => {
        const card = {
          id: `${item.id}-${f.check}-${f.register}`,
          title: `${f.label} (${registerOf(f.register).many})`,
          register: f.register,
          spec: f.spec,
          columns: [],
        };
        return (
          <div className="asst-finding" key={card.id}>
            <div className="asst-finding-line">
              <span className="asst-finding-label">{f.label}</span>
              <span className="asst-finding-reg">{registerOf(f.register).label}</span>
              <span className="asst-finding-count">{f.count.toLocaleString('en-IN')}</span>
            </div>
            {f.examples?.length > 0 && (
              <div className="asst-finding-detail">
                {f.examples.map((ex, i) => (
                  <span key={ex.id}>
                    {i > 0 && ', '}
                    <button type="button" className="asst-link" onClick={() => onOpenRecord(f.register, ex.id)}
                      title={ex.name || ''}>
                      {ex.assetId}
                    </button>
                  </span>
                ))}
                {f.count > f.examples.length && ` and ${(f.count - f.examples.length).toLocaleString('en-IN')} more`}
              </div>
            )}
            <div className="asst-card-actions">
              <button type="button" className="asst-chip" disabled={Boolean(busy)} onClick={() => onRun(card, 'excel')}>
                <Sheet size={13} /> {busyLabel(busy, card.id, 'excel', 'Excel')}
              </button>
              <button type="button" className="asst-chip" disabled={Boolean(busy)} onClick={() => onRun(card, 'open')}>
                <ExternalLink size={13} /> {busyLabel(busy, card.id, 'open', 'Open in Report')}
              </button>
            </div>
          </div>
        );
      })}

      {item.clear > 0 && !nothing && (
        <div className="asst-card-sub asst-card-clear">
          <CheckCircle2 size={12} /> {item.clear} other {item.clear === 1 ? 'check' : 'checks'} all clear.
        </div>
      )}
    </div>
  );
};
