'use client';

import { useEffect, useRef, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';

export type RunSummary = { id: string; question: string; status: string; mode: string; createdAt: string };
export type RunEvent = {
  sequence: number; at: string; agentId: string; type: string; summary: string;
  pid?: number; transaction?: string; entityKey?: string;
};
type Agent = { id: string; name: string };
type Transaction = { type: string; transaction: string; block: string; index: number };
type History = { events: RunEvent[]; transactions: Transaction[]; treasuryUnavailable?: boolean };
type HistoryRequest = (url: string) => Promise<{ runs?: RunSummary[]; history?: History }>;

const transactionLabels: Record<string, string> = {
  TaskCreated: 'Task created',
  Reserved: 'Budget reserved',
  Paid: 'Payment settled',
  WorkerAssigned: 'Worker assigned',
  Expired: 'Reservation expired',
  TaskCancelled: 'Task cancelled',
  Released: 'Budget released',
};

function ReceiptLink({ transaction }: { transaction: string }) {
  return (
    <a className="agent-transaction-hash" href={'/api/integrations?receipt=' + encodeURIComponent(transaction)}
      target="_blank" rel="noreferrer" aria-label={`View transaction receipt ${transaction}`}>
      <code>{transaction}</code>
    </a>
  );
}

export function AgentActivity({ events, agents = [], linkReceipts }: { events: RunEvent[]; agents?: Agent[]; linkReceipts: boolean }) {
  if (!events.length) return <p className="agent-muted">No activity recorded for this selection.</p>;
  return (
    <ol className="agent-timeline" aria-live="polite">
      {events.map(event => (
        <li key={event.sequence}>
          <span className="agent-event-number">{String(event.sequence).padStart(2, '0')}</span>
          <div>
            <strong>{event.type.replaceAll('-', ' ')}</strong>
            <p>{event.summary}</p>
            <small>{agents.find(agent => agent.id === event.agentId)?.name}{agents.length ? ' · ' : ''}
              {new Date(event.at).toLocaleTimeString()}{event.pid ? ` · process ${event.pid}` : ''}</small>
            {event.transaction && (
              <p>{linkReceipts ? <ReceiptLink transaction={event.transaction} /> : <code className="agent-transaction-hash">{event.transaction}</code>}</p>
            )}
            {event.entityKey && <p><a href={'https://rabdi.explorer.arkiv.network/entity/' + encodeURIComponent(event.entityKey)}
              target="_blank" rel="noreferrer">Arkiv record {event.entityKey.slice(0, 12)}…</a></p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

export default function AgentHistory({ agent, initialRunId, request, onClose }: {
  agent: Agent; initialRunId?: string; request: HistoryRequest; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [listError, setListError] = useState('');
  const [runId, setRunId] = useState(initialRunId);
  const [result, setResult] = useState<{ id: string; history?: History; error?: string } | null>(null);
  const [revision, setRevision] = useState(0);
  const historyUrl = '/api/research?agentId=' + encodeURIComponent(agent.id);
  const selected = runs?.find(run => run.id === runId) ?? runs?.[0];
  const selectedId = selected?.id;
  const current = result?.id === selectedId ? result : null;

  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    let active = true;
    void request(historyUrl).then(data => {
      if (active) setRuns(data.runs ?? []);
    }).catch(() => { if (active) setListError('Could not load saved runs.'); });
    return () => { active = false; };
  }, [request, historyUrl, revision]);
  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    void request(historyUrl + '&id=' + encodeURIComponent(selectedId)).then(data => {
      if (active) setResult({ id: selectedId, history: data.history });
    }).catch(() => { if (active) setResult({ id: selectedId, error: 'Could not load agent history.' }); });
    return () => { active = false; };
  }, [request, historyUrl, selectedId, revision]);

  function close() {
    dialog.current?.close();
    onClose();
  }

  return (
    <dialog ref={dialog} className="task-dialog agent-control-center agent-history-dialog" aria-labelledby="agent-history-title"
      onCancel={close} onClick={event => { if (event.target === event.currentTarget) close(); }}>
      <div className="agent-section-bar">
        <h2 id="agent-history-title">{agent.name} history</h2>
        <div className="agent-actions">
          <button className="btn-secondary-pill" onClick={() => { setListError(''); setResult(null); setRevision(value => value + 1); }}><RefreshCw size={13} />Refresh</button>
          <button className="btn-secondary-pill" aria-label="Close agent history" onClick={close}><X size={16} /></button>
        </div>
      </div>
      {listError && <p role="alert">{listError}</p>}
      {!runs && !listError && <p role="status">Loading saved runs…</p>}
      {runs?.length === 0 && <p className="agent-muted">This agent has no saved runs.</p>}
      {selected && (
        <>
          <label>Research run<select value={selected.id} onChange={event => { setRunId(event.target.value); setResult(null); }}>
            {runs?.map(run => (
              <option key={run.id} value={run.id}>{new Date(run.createdAt).toLocaleString()} · {run.question.slice(0, 110)}</option>
            ))}
          </select></label>
          {!current && <p role="status">Loading agent history…</p>}
          {current?.error && <p role="alert">{current.error}</p>}
          {current?.history && (
            <>
              <section className="agent-history-section" aria-label="Task transactions">
                <h3>Task transactions</h3>
                {current.history.treasuryUnavailable ? <p role="status">The chain is unavailable. Saved activity is shown below.</p>
                  : current.history.transactions.length === 0 ? <p className="agent-muted">No confirmed task transactions for this run.</p>
                  : <ul className="agent-timeline">
                    {current.history.transactions.map(entry => (
                      <li key={`${entry.transaction}-${entry.index}`}><div>
                        <strong>{transactionLabels[entry.type] ?? entry.type}</strong>
                        <p><ReceiptLink transaction={entry.transaction} /></p>
                        <small>Block {entry.block}</small>
                      </div></li>
                    ))}
                  </ul>}
              </section>
              <section className="agent-history-section" aria-label="Agent activity">
                <h3>Agent activity</h3>
                <AgentActivity events={current.history.events} linkReceipts={selected.mode === 'paid'} />
              </section>
            </>
          )}
        </>
      )}
    </dialog>
  );
}
