import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, BookOpen, Check, ChevronRight, History, Info, MessageSquare, Plus, Send, ShieldCheck, X,
} from 'lucide-react';
import api, { errorMessage } from '../api';
import { useAssets } from '../context/AssetsContext';
import { useAuth } from '../context/AuthContext';
import {
  MODE_ANSWER, MODE_CHANGES, MODE_LABELS, OUTCOME_LABELS, diffLine,
  isAllowedProposalRequest, rememberMode, shouldStartFresh, storedMode,
} from '../lib/assistant';
import {
  QR_LIMIT, fetchReportRows, historyWhen, openInReportState, pdfColumns, reportFilename,
} from '../lib/assistantReports';
import { exportCSV, exportTableXLSX, exportXLSX } from '../lib/exporters';
import { AttentionCard, ReportCard, TableCard } from './AssistantCards';
import AssistantReportPrint from './AssistantReportPrint';
import QrCodesModal from './QrCodesModal';
import SearchBox from './SearchBox';
import AppLogo from './AppLogo';
import './AssistantPanel.css';

const AssistantPanel = ({ canMakeChanges }) => {
  const navigate = useNavigate();
  const { refresh, setRegister } = useAssets();
  const { user } = useAuth();

  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('ask');
  const [status, setStatus] = useState(null);
  const [mode, setMode] = useState(() => storedMode(canMakeChanges));
  const [conversation, setConversation] = useState(null);
  const [loadedLatest, setLoadedLatest] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [topics, setTopics] = useState(null);
  const [guideSearch, setGuideSearch] = useState('');
  const [openTopic, setOpenTopic] = useState(null);
  const [actingOn, setActingOn] = useState(null);
  const [past, setPast] = useState(null);
  const [pastError, setPastError] = useState('');
  const [reading, setReading] = useState(null);
  const [cardBusy, setCardBusy] = useState(null);
  const [qrJob, setQrJob] = useState(null);
  const [printJob, setPrintJob] = useState(null);
  const threadRef = useRef(null);

  useEffect(() => {
    if (!open || status) return;
    api.get('/assistant/status')
      .then((res) => setStatus(res.data))
      .catch(() => setStatus({ aiEnabled: false, canMakeChanges: false }));
  }, [open, status]);

  useEffect(() => {
    if (!open || !status?.aiEnabled || loadedLatest) return;
    api.get('/assistant/conversations/latest')
      .then((res) => {
        if (res.status === 200 && res.data) setConversation(res.data);
      })
      .catch(() => {  })
      .finally(() => setLoadedLatest(true));
  }, [open, status, loadedLatest]);

  useEffect(() => {
    if (!open || tab !== 'guide' || topics) return;
    api.get('/assistant/guide')
      .then((res) => setTopics(res.data?.topics || []))
      .catch(() => setTopics([]));
  }, [open, tab, topics]);

  useEffect(() => {
    if (!open || tab !== 'history' || past !== null) return undefined;
    let live = true;
    api.get('/assistant/conversations')
      .then((res) => { if (live) setPast(res.data?.items || []); })
      .catch((err) => {
        if (!live) return;
        setPast([]);
        setPastError(errorMessage(err, 'Could not load your past conversations.'));
      });
    return () => { live = false; };
  }, [open, tab, past]);

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [conversation?.items?.length, busy, open, tab]);

  const mayChange = canMakeChanges && status?.canMakeChanges !== false;

  const showTab = (next) => {
    setTab(next);
    setInfo('');
    if (next === 'history') {
      setPast(null);
      setPastError('');
      setReading(null);
    }
  };

  const switchMode = async (next) => {
    if (next === mode) return;
    setError('');
    try {
      await api.post('/assistant/mode', { mode: next, conversationId: conversation?.id || null });
      setMode(next);
      rememberMode(next);
    } catch (err) {
      setError(errorMessage(err, 'Could not switch mode.'));
    }
  };

  const newConversation = async () => {
    setError('');
    const res = await api.post('/assistant/conversations', { mode });
    setConversation(res.data);
    return res.data;
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    setError('');
    setInfo('');
    try {
      const conv = shouldStartFresh(conversation) ? await newConversation() : conversation;
      setConversation({ ...conv, items: [...(conv.items || []), { type: 'user', text, pending: true }] });
      setDraft('');
      const res = await api.post(`/assistant/conversations/${conv.id}/messages`, { text });
      setConversation({
        ...conv,
        items: [...(conv.items || []), ...res.data.items],
        turns: res.data.turns,
        limitReached: res.data.limitReached,
      });
    } catch (err) {
      setError(errorMessage(err, 'The assistant could not answer.'));
      setConversation((c) => (c ? { ...c, items: (c.items || []).filter((i) => !i.pending) } : c));
      setDraft(text);
    } finally {
      setBusy(false);
    }
  };

  const setProposalStatus = (id, statusValue, detail) => {
    setConversation((c) => c && ({
      ...c,
      items: c.items.map((i) => (i.type === 'proposal' && i.id === id
        ? { ...i, status: statusValue, detail: detail || null } : i)),
    }));
  };

  const confirm = async (p) => {
    if (!isAllowedProposalRequest(p)) {
      setError('That change cannot be made from here. Make it in the app instead.');
      return;
    }
    setActingOn(p.id);
    setError('');
    try {
      const res = await api.request({ method: p.method, url: p.path, data: p.payload });
      const held = res?.data?.approvalRequested
        ? 'Sent to the IT head for approval — nothing changes until they approve.'
        : null;
      await api.post(`/assistant/proposals/${p.id}/outcome`,
        held ? { outcome: 'confirmed', detail: held } : { outcome: 'confirmed' });
      setProposalStatus(p.id, 'confirmed', held);
      refresh?.();
    } catch (err) {
      const detail = errorMessage(err, 'The app refused the change.');
      try { await api.post(`/assistant/proposals/${p.id}/outcome`, { outcome: 'failed', detail }); } catch {  }
      setProposalStatus(p.id, 'failed', detail);
    } finally {
      setActingOn(null);
    }
  };

  const decline = async (p) => {
    setActingOn(p.id);
    try {
      await api.post(`/assistant/proposals/${p.id}/outcome`, { outcome: 'declined' });
      setProposalStatus(p.id, 'declined');
    } catch (err) {
      setError(errorMessage(err, 'Could not record that.'));
    } finally {
      setActingOn(null);
    }
  };

  const printReport = async (job) => {
    setPrintJob(job);
    await new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
    const done = () => {
      document.body.classList.remove('asst-printing');
      setPrintJob(null);
      window.removeEventListener('afterprint', done);
    };
    window.addEventListener('afterprint', done);
    document.body.classList.add('asst-printing');
    window.print();
  };

  const runReport = async (card, use) => {
    setCardBusy(`${card.id}:${use}`);
    setError('');
    setInfo('');
    try {
      const data = await fetchReportRows(card, use);
      const rows = data.items || [];
      const register = data.register || card.register;
      if (!rows.length) {
        setInfo('Nothing matches this report any more — the register has changed since it was made.');
        return;
      }
      if (use === 'excel') {
        await exportXLSX(rows, register, reportFilename(card.title, 'xlsx'), card.columns);
      } else if (use === 'csv') {
        exportCSV(rows, register, reportFilename(card.title, 'csv'), card.columns);
      } else if (use === 'pdf') {
        await printReport({
          title: card.title,
          description: data.description,
          register,
          rows,
          columns: pdfColumns(register, card.columns),
          generatedBy: user?.fullName || user?.username || '',
        });
      } else if (use === 'open') {
        setRegister(register);
        navigate('/report', { state: openInReportState(card, rows) });
      } else if (use === 'qr') {
        if (rows.length > QR_LIMIT) {
          setInfo(`Labels for the first ${QR_LIMIT} of ${rows.length}. For the rest, open the report in Report and print them from there in batches.`);
        }
        setQrJob({ register, ids: rows.slice(0, QR_LIMIT).map((r) => r.id) });
      }
    } catch (err) {
      setError(errorMessage(err, 'Could not build that report.'));
    } finally {
      setCardBusy(null);
    }
  };

  const downloadTable = async (item) => {
    setCardBusy(`${item.id}:table`);
    setError('');
    try {
      await exportTableXLSX(item, reportFilename(item.title, 'xlsx'), 'Summary');
    } catch (err) {
      setError(errorMessage(err, 'Could not build that file.'));
    } finally {
      setCardBusy(null);
    }
  };

  const openRecord = (register, id) => navigate(`/report/${register}/${encodeURIComponent(id)}`);

  const readPast = async (id) => {
    setPastError('');
    try {
      const res = await api.get(`/assistant/conversations/${id}`);
      setReading(res.data);
    } catch (err) {
      setPastError(errorMessage(err, 'Could not open that conversation.'));
    }
  };

  const shownTopics = useMemo(() => {
    const q = guideSearch.trim().toLowerCase();
    if (!q) return topics || [];
    return (topics || []).filter((t) => `${t.title} ${t.steps.join(' ')}`.toLowerCase().includes(q));
  }, [topics, guideSearch]);

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const renderItem = (item, i, readOnly = false) => {
    if (item.type === 'report') {
      return <ReportCard key={item.id} item={item} busy={cardBusy} onRun={runReport} />;
    }
    if (item.type === 'table') {
      return <TableCard key={item.id} item={item} busy={cardBusy} onDownloadTable={downloadTable} />;
    }
    if (item.type === 'attention') {
      return (
        <AttentionCard key={item.id} item={item} busy={cardBusy} onRun={runReport}
          onOpenRecord={openRecord} onOpenVerification={() => navigate('/verification')} />
      );
    }
    if (item.type === 'proposal') {
      const pending = item.status === 'pending';
      const statusLabel = readOnly && pending ? 'Not decided' : (OUTCOME_LABELS[item.status] || item.status);
      return (
        <div key={item.id} className={`proposal proposal-${item.status}`}>
          <div className="proposal-head">
            <span className="proposal-record">{item.record}</span>
            <span className={`proposal-status s-${item.status}`}>{statusLabel}</span>
          </div>
          {item.reason && <div className="proposal-reason">{item.reason}</div>}
          <ul className="proposal-diff">
            {item.diff.map((d) => {
              const line = diffLine(d);
              return (
                <li key={d.field}>
                  <span className="diff-label">{line.label}</span>
                  <span className="diff-from">{line.from}</span>
                  <span className="diff-arrow">→</span>
                  <span className="diff-to">{line.to}</span>
                </li>
              );
            })}
          </ul>
          {item.detail && <div className="proposal-detail">{item.detail}</div>}
          {pending && !readOnly && (
            <div className="proposal-actions">
              <button type="button" className="btn-secondary" disabled={actingOn === item.id}
                onClick={() => decline(item)}>Decline</button>
              <button type="button" className="btn-primary proposal-confirm" disabled={actingOn === item.id}
                onClick={() => confirm(item)}>
                <Check size={14} /> {actingOn === item.id ? 'Applying…' : 'Confirm'}
              </button>
            </div>
          )}
        </div>
      );
    }
    return (
      <div key={`${item.type}-${i}`} className={`msg msg-${item.type}${item.pending ? ' msg-pending' : ''}`}>
        {item.text}
      </div>
    );
  };

  if (!open) {
    return (
      <button
        type="button"
        className="assistant-fab"
        onClick={() => setOpen(true)}
        title="Assistant"
        aria-label="Open the assistant"
      >
        <span className="assistant-fab-icon">
          <AppLogo size={22} trace={true} />
        </span>
        <span className="assistant-fab-text">Assistant</span>
      </button>
    );
  }

  const items = conversation?.items || [];
  const tabs = [
    { key: 'ask', label: 'Ask', Icon: MessageSquare },
    { key: 'history', label: 'History', Icon: History },
    { key: 'guide', label: 'Guide', Icon: BookOpen },
  ];

  const notices = (
    <>
      {info && <div className="assistant-info">{info}</div>}
      {error && <div className="assistant-error">{error}</div>}
    </>
  );
  let noticesShown = false;

  let body;
  if (tab === 'guide') {
    body = (
      <div className="assistant-body assistant-guide">
        <SearchBox value={guideSearch} onChange={setGuideSearch}
          placeholder="What do you want to do?" label="Search the guide" />
        {topics === null && <p className="assistant-muted">Loading&hellip;</p>}
        {topics && !shownTopics.length && <p className="assistant-muted">No topic matches that.</p>}
        <ul className="guide-list">
          {shownTopics.map((t) => (
            <li key={t.id} className={openTopic === t.id ? 'open' : ''}>
              <button type="button" className="guide-topic" onClick={() => setOpenTopic(openTopic === t.id ? null : t.id)}
                aria-expanded={openTopic === t.id}>
                <ChevronRight size={14} className="guide-caret" /> {t.title}
              </button>
              {openTopic === t.id && (
                <div className="guide-steps">
                  <ol>{t.steps.map((s) => <li key={s}>{s}</li>)}</ol>
                  {t.route && (
                    <button type="button" className="btn-secondary guide-go" onClick={() => navigate(t.route)}>
                      Take me there
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    );
  } else if (tab === 'history') {
    body = reading ? (
      <>
        <div className="assistant-history-bar">
          <button type="button" className="assistant-back" onClick={() => setReading(null)}>
            <ArrowLeft size={14} /> All conversations
          </button>
          <span className="assistant-muted">Read-only</span>
        </div>
        <div className="assistant-body assistant-thread">
          {(reading.items || []).map((item, i) => renderItem(item, i, true))}
          <div className="msg msg-notice">
            This is a past conversation. Its reports still download, with today&rsquo;s data.
            To ask something new, use the <strong>Ask</strong> tab.
          </div>
        </div>
      </>
    ) : (
      <div className="assistant-body">
        {pastError && <div className="assistant-error assistant-error-inline">{pastError}</div>}
        {past === null && <p className="assistant-muted">Loading&hellip;</p>}
        {past && !past.length && !pastError && (
          <p className="assistant-muted">No conversations in the last 7 days.</p>
        )}
        {past && past.length > 0 && (
          <>
            <p className="assistant-muted assistant-history-note">Your conversations from the last 7 days.</p>
            <ul className="history-list">
              {past.map((c) => (
                <li key={c.id}>
                  <button type="button" className="history-item" onClick={() => readPast(c.id)}>
                    <span className="history-title">{c.title}</span>
                    <span className="history-meta">
                      {historyWhen(c.updatedAt)} · {c.turns} {c.turns === 1 ? 'question' : 'questions'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    );
  } else if (status && !status.aiEnabled) {
    body = (
      <div className="assistant-body">
        <p className="assistant-muted">
          The AI assistant is not set up on this server. The <strong>Guide</strong> tab
          has step-by-step help for everything you can do here.
        </p>
      </div>
    );
  } else {
    noticesShown = true;
    body = (
      <>
        <div className="assistant-mode" role="radiogroup" aria-label="Assistant mode">
          {[MODE_ANSWER, MODE_CHANGES].map((m) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m}
              className={mode === m ? 'active' : ''}
              disabled={m === MODE_CHANGES && !mayChange}
              title={m === MODE_CHANGES && !mayChange
                ? 'Your profile is read-only, so the assistant can only answer.'
                : (m === MODE_CHANGES
                  ? 'It can prepare changes for you to confirm. Nothing changes until you press Confirm.'
                  : 'It looks things up and explains how to do them.')}
              onClick={() => switchMode(m)}>
              {m === MODE_CHANGES ? <ShieldCheck size={13} /> : <MessageSquare size={13} />}
              {MODE_LABELS[m]}
            </button>
          ))}
          <button type="button" className="assistant-new" onClick={() => { setConversation(null); setError(''); setInfo(''); }}
            title="Start a new conversation" aria-label="New conversation">
            <Plus size={14} />
          </button>
        </div>

        <div className="assistant-body assistant-thread" ref={threadRef}>
          {!items.length && (
            <div className="assistant-empty">
              <p>Ask about the register or how to do something. For example:</p>
              <ul>
                <li>How many laptops are in stock?</li>
                <li>Excel of Dell laptops bought before 2022 at Patna</li>
                <li>Laptops by location and status</li>
                <li>What needs attention?</li>
                <li>QR labels for everything added this week</li>
              </ul>
              <p className="assistant-muted">It only helps with IT Asset Engine. Every change you confirm is recorded in the Activity Log.</p>
            </div>
          )}
          {items.map((item, i) => renderItem(item, i))}
          {busy && (
            <div className="msg msg-assistant msg-thinking" role="status" aria-label="Assistant is thinking">
              <div className="thinking-bubble">
                <AppLogo size={22} gradient={true} className="thinking-logo" />
              </div>
            </div>
          )}
          {conversation?.limitReached && (
            <div className="msg msg-notice">
              That&rsquo;s {conversation.turns || 'several'} questions in this conversation. Your next
              one starts a new conversation, which keeps answers quick and cheap. For an unrelated
              question, you can start one any time with +.
            </div>
          )}
        </div>

        {notices}

        <div className="assistant-compose">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={mode === MODE_CHANGES
              ? 'Ask, or say what to change…'
              : 'Ask about the register or the app…'}
            rows={2}
            maxLength={2000}
            disabled={busy || !status}
            aria-label="Your question"
          />
          <button type="button" className="btn-primary assistant-send" onClick={send}
            disabled={busy || !draft.trim() || !status} aria-label="Send">
            <Send size={15} />
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <aside className="assistant-panel" role="dialog" aria-label="Assistant">
        <header className="assistant-head">
          <div className="assistant-title"><AppLogo size={17} /> Assistant</div>
          <div className="assistant-tabs" role="tablist">
            {tabs.map(({ key, label, Icon }) => (
              <button key={key} type="button" role="tab" aria-selected={tab === key}
                className={tab === key ? 'active' : ''} onClick={() => showTab(key)}>
                <Icon size={13} /> {label}
              </button>
            ))}
          </div>
          <button type="button" className="assistant-close" onClick={() => setOpen(false)} aria-label="Close the assistant">
            <X size={16} />
          </button>
        </header>

        <div className="assistant-mobile-note" role="note">
          <Info size={14} aria-hidden="true" />
          <span>The assistant covers the app on this screen. Close it to use the rest of the app.</span>
          <button type="button" className="assistant-mobile-note-close" onClick={() => setOpen(false)}>
            Close
          </button>
        </div>

        {body}
        {!noticesShown && notices}
      </aside>

      {qrJob && createPortal(
        <QrCodesModal ids={qrJob.ids} register={qrJob.register} onClose={() => setQrJob(null)} />,
        document.body,
      )}
      <AssistantReportPrint report={printJob} />
    </>
  );
};

export default AssistantPanel;
