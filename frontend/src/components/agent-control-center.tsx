'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, Plus, ArrowRight, KeyRound, X, Play, Pause, RefreshCw, Archive, Activity, GitBranch } from 'lucide-react';
import { targetChain, useRelayAuth } from '@/context/privy-auth-context';
import PaymentReceipt from './payment-receipt';
import { agentPaymentReceipts } from '@/lib/payment-receipts.mjs';
import AgentHistory, { AgentActivity, type RunEvent, type RunSummary } from './agent-history';
import './agent-control-center.css';

type Agent = { id: string; name: string; responsibility: string; credentialId: string; model: string; archived?: boolean };
type Config = { workflow: 'research-v1'; agents: Agent[] };
type Credential = { id: string; label: string; provider: string };
type Artifact = { text: string; agentId: string; provider: string; model: string; requestId: string | null; step: string };
type Run = RunSummary & { testnet?: {chainId:number}; financialError?:string; financial?: {chainId:number;block:string;unallocated:string;withdrawn:string;tasks?:Record<string,{id:string;worker:string;epoch:string;available:string;reserved:string;spent:string}>;payments?:{transaction:string;taskId?:string;amount:string}[]}; config: Config; events: RunEvent[]; workers: Record<string, { status: string; attempt: number; pid: number | null; heartbeat: string | null }>; artifacts: Record<string, Artifact>; report: Artifact | null; error?: string; treasuryUnavailable?: boolean; tasks?: Record<string, { id: string; worker: string; epoch: string; available: string; reserved: string; spent: string } | null> };
const providers = ['openai', 'anthropic', 'gemini', 'openrouter', 'groq', 'nvidia'];
const emptyAgent = (): Agent => ({ id: crypto.randomUUID(), name: '', responsibility: '', credentialId: '', model: '' });
const modeLabel = (mode: string) => ({ fixture: 'Local fixture', llm: 'Live models', paid: 'Local paid research' })[mode] || mode;
const terminal = ['completed', 'cancelled', 'failed'];

export default function AgentControlCenter({ view }: { view: 'Agents' | 'Runs' | 'Credentials' | 'Integrations' }) {
  const auth = useRelayAuth();
  const { getAccessToken, authenticated } = auth;
  const [config, setConfig] = useState<Config | null>(null), [credentials, setCredentials] = useState<Credential[]>([]);
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const [agent, setAgent] = useState<Agent | null>(null), [provider, setProvider] = useState('openai'), [label, setLabel] = useState(''), [key, setKey] = useState('');
  const [history, setHistory] = useState<{ agent: Agent; runId?: string } | null>(null);
  const [runs, setRuns] = useState<RunSummary[]>([]), [run, setRun] = useState<Run | null>(null), [runId, setRunId] = useState('');
  const [question, setQuestion] = useState('Compare the benefits and limitations of task-owned budgets for research agents.');
  const [selectedMode, setMode] = useState<string | null>(null), [billing, setBilling] = useState(false), [interrupt, setInterrupt] = useState(true);
  const [paidSourcePrice, setPaidSourcePrice] = useState<string | null | undefined>(undefined), [holdPaidCheckpoint, setHoldPaidCheckpoint] = useState(true);
  const mode = selectedMode ?? (paidSourcePrice ? 'paid' : 'fixture');
  const [funding, setFunding] = useState(false), [cap, setCap] = useState('100000');
  const [teamCredential, setTeamCredential] = useState(''), [teamModel, setTeamModel] = useState('');
  const [showcase, setShowcase] = useState<{enabled:boolean;merchantReady?:boolean;sourcePrice?:string;error?:string}|null>(null);
  const [filter, setFilter] = useState('all');
  const [profiles, setProfiles] = useState<{ entityKey: string; name: string; owner: string; worker: string; capabilities: string }[] | null>(null);
  const [network, setNetwork] = useState<{ chainId: number; deploymentPresent: boolean } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useCallback(async (url: string, body?: unknown) => {
    const token = await getAccessToken();
    const response = await fetch(url, { method: body ? 'POST' : 'GET', cache: 'no-store', headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Request failed'); return data;
  }, [getAccessToken]);
  useEffect(() => {
    if (!authenticated) return;
    let active = true;
    void request('/api/workbench').then(data => { if (active) { setConfig(data.config); setCredentials(data.credentials); } }).catch(error => { if (active) setMessage(error.message); });
    return () => { active = false; };
  }, [request, authenticated]);
  useEffect(() => {
    if (view !== 'Runs' || !authenticated) return;
    let active = true, timer: ReturnType<typeof setTimeout>;
    const update = async () => {
      try {
        const data = await request('/api/research');
        if (!active) return;
        setRuns(data.runs);
        setPaidSourcePrice(data.paidSourcePrice ?? null);
        const selected = runId || data.runs[0]?.id;
        if (selected) {
          const detail = await request('/api/research?id=' + encodeURIComponent(selected));
          if (active) { setRun(detail.run); if (!runId) setRunId(selected); }
        }
      } catch (error) { if (active) setMessage(error instanceof Error ? error.message : 'Could not refresh monitor'); }
      if (active) timer = setTimeout(() => void update(), 2000);
    };
    void update();
    return () => { active = false; clearTimeout(timer); };
  }, [view, request, authenticated, runId]);
  useEffect(() => { if (!authenticated) return; let active=true; void request('/api/showcase').then(data=>{if(active)setShowcase(data);}).catch(()=>{}); return()=>{active=false;}; }, [authenticated,request]);
  useEffect(() => { if (agent) dialog.current?.showModal(); else dialog.current?.close(); }, [agent]);
  async function action(fn: () => Promise<void>) {
    setBusy(true); setMessage(''); try { await fn(); } catch (error) { setMessage(error instanceof Error ? error.message : 'Action failed'); } finally { setBusy(false); }
  }
  async function save(next: Config) {
    const data = await request('/api/workbench', { action: 'saveConfig', config: next });
    setConfig(data.config); setMessage('Agent configuration saved. On-chain authority is unchanged.');
  }
  const agents = config?.agents || [], activeAgents = agents.filter(item => !item.archived);
  const filteredEvents = (run?.events || []).filter(event => filter === 'all' || filter === event.agentId);
  return <div className="agent-control-center">
    {message && <div className="notice" role="status">{message}</div>}
    {!config && <p className="agent-muted">Loading your workspace…</p>}
    {view === 'Agents' && <>
      <div className="agent-section-bar"><div><h3>Agent directory</h3><p className="agent-muted">One Janus coordinator. Up to six independently running research workers.</p></div><button className="btn-secondary-pill" disabled={!config || busy || agents.length >= 7} onClick={() => setAgent(emptyAgent())}><Plus size={15} />Create agent</button></div>
      <div className="dashboard-metrics-grid">{[{ label: 'Active agents', value: activeAgents.length }, { label: 'Parallel workers', value: activeAgents.filter(item => item.id !== 'orchestrator').length }, { label: 'Saved credentials', value: credentials.length }, { label: 'Settlement', value: 'Hedera' }].map(metric => <div className="spotlight-card" key={metric.label}><span className="agent-muted">{metric.label}</span><strong className="agent-metric">{metric.value}</strong></div>)}</div>
      <div className="agent-card-grid">{agents.map(item => <article className="spotlight-card" key={item.id}>
        <div className="agent-section-bar"><Bot size={20} /><span className="hash-tag">{item.archived ? 'ARCHIVED' : item.id === 'orchestrator' ? 'COORDINATOR' : 'RESEARCH WORKER'}</span></div>
        <h3><button className="agent-card-title" aria-label={`View history for ${item.name}`} onClick={() => setHistory({ agent: item })}>{item.name}<Activity size={15} /></button></h3>
        <p className="agent-muted">{item.responsibility}</p>
        <dl className="agent-facts"><div><dt>Provider</dt><dd>{credentials.find(record => record.id === item.credentialId)?.provider || 'Not assigned'}</dd></div><div><dt>Model</dt><dd>{item.model || 'Fixture only'}</dd></div></dl>
        <div className="agent-actions"><button className="btn-secondary-pill" disabled={busy} onClick={() => setAgent({ ...item })}>Configure <ArrowRight size={13} /></button>{item.id !== 'orchestrator' && <button className="btn-secondary-pill" disabled={!config || busy} onClick={() => void action(() => save({ ...config!, agents: agents.map(a => a.id === item.id ? { ...a, archived: !a.archived } : a) }))}><Archive size={13} />{item.archived ? 'Restore' : 'Archive'}</button>}</div>
      </article>)}</div>
      <details><summary>Apply a model to the team</summary><label>Team credential<select value={teamCredential} onChange={event=>setTeamCredential(event.target.value)}><option value="">Choose credential</option>{credentials.map(c=><option key={c.id} value={c.id}>{c.label} · {c.provider}</option>)}</select></label><label>Provider model ID<input value={teamModel} onChange={event=>setTeamModel(event.target.value)}/></label><button className="btn-secondary-pill" disabled={busy||!teamCredential||!teamModel} onClick={()=>void action(()=>save({...config!,agents:agents.map(a=>({...a,credentialId:teamCredential,model:teamModel}))}))}>Apply to team</button></details>
      <p className="agent-muted">Worker definitions do not hold a fresh allowance. Task budgets and spending authority remain with the treasury.</p>
    </>}
    {view === 'Credentials' && <div className="dashboard-two-col-grid">
      <section className="spotlight-card"><KeyRound size={20} /><h3>Add provider credential</h3><p className="agent-muted">Encrypted on the server and scoped to your verified account. Saving makes no provider request.</p>
        <form onSubmit={event => { event.preventDefault(); void action(async () => { await request('/api/workbench', { action: 'saveCredential', credential: { provider, label, key } }); setKey(''); setLabel(''); setCredentials((await request('/api/workbench')).credentials); setMessage('Credential saved. Assign it to an agent.'); }); }}>
          <label>Provider<select value={provider} onChange={event => setProvider(event.target.value)}>{providers.map(value => <option key={value}>{value}</option>)}</select></label>
          <label>Label<input required maxLength={60} value={label} onChange={event => setLabel(event.target.value)} placeholder="Research team key" /></label>
          <label>API key<input required type="password" autoComplete="new-password" spellCheck={false} minLength={16} maxLength={4096} value={key} onChange={event => setKey(event.target.value)} placeholder="Your provider API key" /></label>
          <button className="btn-secondary-pill" disabled={busy}><Plus size={14} />Save credential</button>
        </form>
      </section>
      <section className="spotlight-card"><h3>Saved credentials</h3>{credentials.length === 0 && <p className="agent-muted">No keys saved. Local research fixtures need none.</p>}{credentials.map(item => <div className="agent-list-row" key={item.id}><div><strong>{item.label}</strong><p className="agent-muted">{item.provider} · encrypted</p></div><button className="btn-secondary-pill" disabled={busy} onClick={() => void action(async () => { await request('/api/workbench', { action: 'removeCredential', id: item.id }); setCredentials(current => current.filter(record => record.id !== item.id)); })}>Revoke</button></div>)}<p className="agent-muted">Provider API calls are billed externally. Treasury tool-payment limits do not cap your provider invoice.</p></section>
    </div>}
    {view === 'Integrations' && <>
      <div className="dashboard-two-col-grid"><section className="spotlight-card"><h3>Treasury connection</h3><p className="agent-muted">Check the active deployment and RPC.</p><button className="btn-secondary-pill" disabled={busy} onClick={() => void action(async () => { const response = await fetch('/api/integrations', { method: 'POST' }); const data = await response.json(); if (!response.ok) throw new Error(data.error); setNetwork(data.hedera); })}><RefreshCw size={14} />Check treasury</button>{network && <p>Chain {network.chainId} · {network.deploymentPresent ? 'Contract code found' : 'No contract code found'}</p>}</section>
      <section className="spotlight-card"><h3>Arkiv research directory</h3><p className="agent-muted">Public, expiring worker profiles. A profile is discovery metadata, not financial permission.</p><div className="agent-actions"><button className="btn-secondary-pill" disabled={busy} onClick={() => void action(async () => { const directory = await import('@/lib/arkiv-directory'); setProfiles(await directory.listArkivWorkers(targetChain.id)); })}>Read directory</button><button className="btn-secondary-pill" disabled={busy || !auth.walletAddress} onClick={() => void action(async () => { const wallet = await auth.getWalletProvider(); if (!wallet || !auth.walletAddress) throw new Error('Connect a dedicated testnet wallet'); const directory = await import('@/lib/arkiv-directory'); const result = await directory.registerArkivWorker(wallet, auth.walletAddress as `0x${string}`, activeAgents.find(item => item.id !== 'orchestrator')?.name || 'Research worker', targetChain.id); setMessage(`Profile published: ${result.entityKey}. Transaction: ${result.txHash}`); setProfiles(await directory.listArkivWorkers(targetChain.id)); })}>Publish worker</button></div><p className="agent-muted">Publishing requests a wallet signature and testnet gas. Never publish secrets or private prompts. Local paid runs search for compatible profiles on their execution network after worker interruption.</p></section></div>
      {profiles && <section className="spotlight-card"><h3>Worker profiles</h3>{profiles.length === 0 && <p className="agent-muted">No eligible profiles returned. Do not assume a replacement is available.</p>}{profiles.map(profile => <div className="agent-list-row" key={profile.entityKey}><div><strong>{profile.name}</strong><p className="agent-muted">{profile.worker} · {profile.capabilities}</p></div><button className="btn-secondary-pill" disabled={busy || !config || agents.length >= 7} onClick={() => setAgent({ ...emptyAgent(), name: profile.name.slice(0, 50), responsibility: `Research using the public ${profile.capabilities} worker profile ${profile.entityKey}. Check evidence and respect task authority.` })}>Configure worker</button></div>)}</section>}
    </>}
    {view === 'Runs' && <>
      <div className="dashboard-two-col-grid"><section className="spotlight-card"><div className="agent-section-bar"><h3>Start research</h3><GitBranch size={20} /></div>
        <form onSubmit={event => { event.preventDefault(); void action(async () => { if (!config) throw new Error('Workspace is not loaded'); if(mode==='testnet'&&(!funding||!billing))throw new Error('Approve the task budget and separate model billing.'); const data = await request('/api/research', { action: 'create', question, mode:mode==='testnet'?'llm':mode, testnet:mode==='testnet', confirmTestnetFunds:funding, taskCap:cap, maxPerOp:showcase?.sourcePrice, autoRecoveryDemo:false, confirmProviderBilling: billing, interrupt, holdPaidCheckpoint }); setRun(data.run); setRunId(data.run.id); setRuns(current => [data.run, ...current]); }); }}>
          <label>Research question<textarea rows={3} required minLength={10} maxLength={6000} value={question} onChange={event => setQuestion(event.target.value)} /></label>
          <label>Execution mode<select value={mode} onChange={event => { setMode(event.target.value); setBilling(false); }}><option value="fixture">Local fixture · no provider calls</option><option value="llm">Live models · your saved API keys</option>{showcase?.enabled&&<option value="testnet">Hedera testnet · paid sources and live models</option>}{paidSourcePrice && <option value="paid">Local paid research · test tokens</option>}</select></label>
          {mode === 'paid' ? <><p>Each worker can spend {paidSourcePrice} local test-token base units on one treasury reference source.</p><label className="agent-checkbox"><input type="checkbox" checked={holdPaidCheckpoint} onChange={event => setHoldPaidCheckpoint(event.target.checked)} />Wait at the first paid checkpoint for manual interruption</label></> : mode === 'fixture' ? <label className="agent-checkbox"><input type="checkbox" checked={interrupt} onChange={event => setInterrupt(event.target.checked)} />Interrupt first worker after checkpoint; demonstrate replacement</label> : <label className="agent-checkbox"><input type="checkbox" checked={billing} onChange={event => setBilling(event.target.checked)} />I approve provider billing: one planning call, one per active worker, and one report call (up to 800 output tokens each).</label>}
          {mode==='testnet'&&<><label>Budget per worker (test USDC base units)<input type="number" min={Number(showcase?.sourcePrice||20000)} max="100000" step="1000" required value={cap} onChange={event=>setCap(event.target.value)}/></label><label className="agent-checkbox"><input type="checkbox" checked={funding} onChange={event=>setFunding(event.target.checked)}/>I authorize these bounded testnet task budgets from the dedicated showcase treasury.</label></>}
          <button className="btn-secondary-pill" disabled={busy || !config || paidSourcePrice === undefined || ((mode === 'llm'||mode === 'testnet') && !billing) || (mode==='testnet'&&(!funding||!showcase?.merchantReady))}><Play size={14} />Start run</button>
        </form><p className="agent-muted">Local paid research uses the configured merchant and a funded local treasury. Live model calls use your provider account.</p>
      </section><section className="spotlight-card"><h3>Saved runs</h3><div className="agent-run-list">{runs.length === 0 && <p className="agent-muted">Your research runs will appear here.</p>}{runs.map(item => <button aria-pressed={runId === item.id} className="agent-run-option" key={item.id} onClick={() => { setRunId(item.id); setFilter('all'); }}><span>{item.question}</span><small>{item.status} · {modeLabel(item.mode)}</small></button>)}</div></section></div>
      {run && <>
        <div className="agent-section-bar"><div><h3>Janus orchestrator <span className="hash-tag">{run.status.toUpperCase()}</span></h3><p className="agent-muted">Run {run.id} · {run.testnet?'Hedera Testnet · live models':modeLabel(run.mode)}</p></div><div className="agent-actions">{!terminal.includes(run.status) && <><button className="btn-secondary-pill" disabled={busy || !['running', 'queued'].includes(run.status)} onClick={() => void action(async () => { await request('/api/research', { action: 'pause', id: run.id }); setMessage('Pause requested. In-flight calls finish before the run pauses.'); })}><Pause size={13} />Pause</button><button className="btn-secondary-pill" disabled={busy || run.status !== 'paused'} onClick={() => void action(async () => { await request('/api/research', { action: 'resume', id: run.id }); setMessage('Resume requested for the original run.'); })}><RefreshCw size={13} />Resume</button><button className="btn-secondary-pill" disabled={busy} onClick={() => void action(async () => { await request('/api/research', { action: 'cancel', id: run.id }); setMessage('Cancellation requested. No treasury cancellation or refund is implied.'); })}><X size={13} />Cancel</button></>}</div></div>
        {run.error && <div className="notice" role="alert">{run.error}</div>}{run.financialError&&<div className="notice" role="alert">{run.financialError}</div>}
        {run.treasuryUnavailable && <p role="alert">Live treasury balances are temporarily unavailable.</p>}
        <div className="agent-card-grid">{run.config.agents.map(item => {
          const state = run.workers[item.id], task = run.financial?.tasks?.[item.id]??run.tasks?.[item.id];
          const controlWorker = (workerAction: string) => void action(async () => {
            await request('/api/research', { action: workerAction, id: run.id, agentId: item.id, attempt: state.attempt });
          }); return <article className="spotlight-card" key={item.id}><div className="agent-section-bar"><Bot size={18} /><span className={`hash-tag ${['failed','waiting-replacement','interrupted'].includes(state?.status||'')?'agent-state-interrupted':state?.status==='completed'?'agent-state-success':''}`}>{item.id === 'orchestrator' ? 'COORDINATOR' : state?.status || 'WAITING'}</span></div>
          <h3><button className="agent-card-title" aria-label={`View history for ${item.name}`} onClick={() => setHistory({ agent: item, runId: run.id })}>{item.name}<Activity size={15} /></button></h3>
          <p className="agent-muted">{item.responsibility}</p><dl className="agent-facts"><div><dt>Process</dt><dd>{state?.pid ?? 'Supervisor'}</dd></div><div><dt>Heartbeat</dt><dd>{state?.heartbeat ? new Date(state.heartbeat).toLocaleTimeString() : "—"}</dd></div><div><dt>Attempt</dt><dd>{state?.attempt ?? 1}</dd></div><div><dt>Artifacts</dt><dd>{Object.values(run.artifacts).filter(a => a.agentId === item.id).length}</dd></div>
          {task && <><div><dt>Available</dt><dd>{task.available}</dd></div><div><dt>Reserved</dt><dd>{task.reserved}</dd></div><div><dt>Spent</dt><dd>{task.spent}</dd></div><div><dt>Epoch</dt><dd>{task.epoch}</dd></div></>}
          </dl>
          <div aria-label={`${item.name} successful payments`} aria-live="polite">{agentPaymentReceipts(run.events,item.id,run.financial?.payments??[],run.financial?.tasks?.[item.id]?.id??task?.id).map(payment=><PaymentReceipt key={payment.transaction} transaction={payment.transaction} chainId={run.financial?.chainId??run.testnet?.chainId} confirmed />)}</div>
          {task && <details><summary>{run.testnet?'Hedera treasury task · USDC base units':'Local treasury task · test-token base units'}</summary><p className="agent-muted">Task {task.id}<br />Worker {task.worker}</p></details>}
          {run.status === 'running' && state && ['running', 'paid-checkpoint'].includes(state.status) && <div className="agent-actions">
            <button className="btn-secondary-pill" disabled={busy} onClick={() => controlWorker('interrupt')}>Interrupt worker</button>
            {state.status === 'paid-checkpoint' && <button className="btn-secondary-pill" disabled={busy} onClick={() => controlWorker('continue')}>Continue worker</button>}
          </div>}
        </article>; })}</div>
        <section className="spotlight-card"><div className="agent-section-bar"><h3><Activity size={16} /> Activity timeline</h3><label className="agent-filter">Filter agent<select aria-label="Filter activity by agent" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">All agents</option>{run.config.agents.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label></div>
          <AgentActivity events={filteredEvents} agents={run.config.agents} linkReceipts={run.mode === 'paid'} chainId={run.financial?.chainId??run.testnet?.chainId} />
        </section>
        <section className="spotlight-card"><h3>Research artifacts</h3>{Object.values(run.artifacts).map(artifact => <details key={artifact.step}><summary>{run.config.agents.find(item => item.id === artifact.agentId)?.name} · {artifact.step} · {artifact.provider}</summary><pre className="agent-artifact">{artifact.text}</pre><small className="agent-muted">{artifact.model} · request {artifact.requestId || 'local fixture'}</small></details>)}</section>
        {run.report && <section className="spotlight-card"><h3>Final report</h3><pre className="agent-artifact">{run.report.text}</pre></section>}
      </>}
    </>}
    {history && <AgentHistory agent={history.agent} initialRunId={history.runId} chainId={history.runId===run?.id?(run?.financial?.chainId??run?.testnet?.chainId):undefined} request={request} onClose={() => setHistory(null)} />}
    <dialog ref={dialog} className="task-dialog agent-control-center" onCancel={() => setAgent(null)} onClick={event => { if (event.target === event.currentTarget) setAgent(null); }}>
      {agent && <form onSubmit={event => { event.preventDefault(); void action(async () => { if (!config) return; const exists = agents.some(item => item.id === agent.id); await save({ ...config, agents: exists ? agents.map(item => item.id === agent.id ? agent : item) : [...agents, agent] }); setAgent(null); }); }}>
        <div className="agent-section-bar"><h2>{agents.some(item => item.id === agent.id) ? 'Configure agent' : 'Create agent'}</h2><button type="button" className="btn-secondary-pill" aria-label="Close agent form" onClick={() => setAgent(null)}><X size={16} /></button></div>
        <label>Name<input required maxLength={50} value={agent.name} onChange={event => setAgent({ ...agent, name: event.target.value })} /></label>
        <label>Research responsibility<textarea required rows={3} maxLength={1500} value={agent.responsibility} onChange={event => setAgent({ ...agent, responsibility: event.target.value })} /></label>
        <label>Provider credential<select value={agent.credentialId} onChange={event => setAgent({ ...agent, credentialId: event.target.value })}><option value="">None · fixture only</option>{credentials.map(item => <option key={item.id} value={item.id}>{item.label} · {item.provider}</option>)}</select></label>
        <label>Model ID<input maxLength={100} value={agent.model} placeholder="Exact model ID from your provider" onChange={event => setAgent({ ...agent, model: event.target.value })} /></label>
        <p className="agent-muted">Saving creates a worker definition. It does not make a model call, grant financial authority, or allocate new funds.</p><button className="btn-secondary-pill" disabled={busy}>Save agent <ArrowRight size={14} /></button>
      </form>}
    </dialog>
  </div>;
}
