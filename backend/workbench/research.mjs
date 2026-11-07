import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createWorkbenchStore } from './store.mjs';
import { validateWorkbenchConfig } from './config.mjs';
import { callProvider } from './providers.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const terminal = new Set(['completed', 'failed', 'cancelled']);
export const accountDirectory = (root, user) => path.join(root, 'research', digest(user));
export function runDirectory(root, user, id) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid run ID');
  return path.join(accountDirectory(root, user), id);
}
export async function atomic(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = file + '.' + randomUUID() + '.tmp';
  const handle = await fs.open(temp, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); } finally { await handle.close(); }
  await fs.rename(temp, file);
}
export const readRun = async (root, user, id) => JSON.parse(await fs.readFile(path.join(runDirectory(root, user, id), 'run.json'), 'utf8'));
export async function listRuns(root, user) {
  let names;
  try { names = await fs.readdir(accountDirectory(root, user)); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  const results = await Promise.all(names.filter(name => /^[a-f0-9-]{36}$/.test(name)).map(id => readRun(root, user, id)));
  return results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export async function createRun(root, user, { config, question, mode, confirmProviderBilling, interrupt = false, deployment, holdPaidCheckpoint = false }) {
  config = validateWorkbenchConfig(config);
  config.agents = config.agents.filter(agent => !agent.archived);
  if (typeof question !== 'string' || question.trim().length < 10 || question.length > 6000) throw new Error('Enter a research question of 10–6000 characters');
  if (!['fixture', 'llm', 'paid'].includes(mode) || (mode === 'paid' && deployment?.mode !== 'local')) throw new Error('Choose fixture or provider mode');
  if (mode === 'llm' && confirmProviderBilling !== true) throw new Error('Confirm separate provider billing');
  const vault = createWorkbenchStore(path.join(root, 'vault'));
  if (mode === 'llm') for (const agent of config.agents) {
    if (!agent.credentialId || !agent.model) throw new Error('Assign a credential and model to every active agent');
    await vault.credential(user, agent.credentialId);
  }
  const directory = accountDirectory(root, user);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const lock = await fs.open(path.join(directory, 'create.lock'), 'wx', 0o600).catch(() => { throw new Error('Run creation busy; retry'); });
  try {
    const runs = await listRuns(root, user);
    if (runs.filter(run => !terminal.has(run.status)).length >= 2) throw new Error('Two runs already active; finish or cancel one');
    if (runs.length >= 100) throw new Error('Run retention limit reached; operator archival required');
    const run = { id: randomUUID(), version: 1, createdAt: new Date().toISOString(), question: question.trim(), mode,
      config, interrupt: mode === 'fixture' && interrupt === true, status: 'queued', events: [], artifacts: {}, workers: {}, report: null };
    if (mode === 'paid') {
      run.deployment = deployment;
      run.holdPaidCheckpoint = holdPaidCheckpoint === true;
    }
    await atomic(path.join(runDirectory(root, user, run.id), 'run.json'), run);
    return run;
  } finally { await lock.close(); await fs.unlink(path.join(directory, 'create.lock')); }
}
export async function controlRun(root, user, id, action, { agentId, attempt } = {}) {
  const run = await readRun(root, user, id);
  if (terminal.has(run.status)) throw new Error('Run already finished');
  const dir = runDirectory(root, user, id);
  if (['interrupt', 'continue'].includes(action)) {
    const worker = run.workers[agentId];
    if (run.status !== 'running' || !worker || worker.attempt !== attempt ||
        !run.config.agents.some(agent => agent.id === agentId && agent.id !== 'orchestrator') ||
        !(action === 'continue' ? ['paid-checkpoint'] : ['running', 'paid-checkpoint']).includes(worker.status)) {
      throw new Error('Worker attempt is no longer available');
    }
    await (await fs.open(workerControl(dir, agentId, attempt, action), 'a', 0o600)).close();
    return run;
  }
  if (!['pause', 'resume', 'cancel'].includes(action)) throw new Error('Invalid run action');
  if (action === 'resume' && !['paused', 'queued'].includes(run.status)) throw new Error('Resume is allowed only for paused or queued runs; uncertain submissions require reconciliation');
  await atomic(path.join(dir, 'control.json'), { action, at: new Date().toISOString() });
  // When no supervisor owns the run, cancellation is a local execution action only.
  if (action === 'cancel') {
    let locked;
    try { locked = await fs.open(path.join(dir, 'supervisor.lock'), 'wx', 0o600); } catch (e) { if (e.code !== 'EEXIST') throw e; }
    if (locked) { try { run.status = 'cancelled'; await atomic(path.join(dir, 'run.json'), run); } finally { await locked.close(); await fs.unlink(path.join(dir, 'supervisor.lock')); } }
  }
  return run;
}

const workerControl = (directory, agentId, attempt, action) => path.join(directory, `worker-${digest(agentId)}-${attempt}-${action}`);
async function hasControl(file) {
  try { await fs.access(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

export async function executeResearch({ root, user, id, providerCall = callProvider, paidTools, createPaidTools, interruptAfterPaid = false }) {
  const directory = runDirectory(root, user, id), lockPath = path.join(directory, 'supervisor.lock');
  const lock = await fs.open(lockPath, 'wx', 0o600).catch(() => { throw new Error('Supervisor already active or stale lock; reconcile before retry'); });
  let run, queue = Promise.resolve();
  const children = new Set();
  try {
    run = await readRun(root, user, id);
    if (terminal.has(run.status) || run.status === 'reconciling') return run;
    const save = () => { queue = queue.then(() => atomic(path.join(directory, 'run.json'), run)); return queue; };
    const event = async (type, agentId, summary, extra = {}) => {
      run.events.push({ sequence: run.events.length + 1, at: new Date().toISOString(), type, agentId, summary, ...extra });
      if (run.events.length > 2000) throw new Error('Run event limit exceeded');
      await save();
    };
    const control = async () => {
      try { return JSON.parse(await fs.readFile(path.join(directory, 'control.json'), 'utf8')).action; } catch (e) { if (e.code === 'ENOENT') return 'resume'; throw e; }
    };
    const stopped = async () => ['pause', 'cancel'].includes(await control());
    delete run.error;
    if (run.mode === 'paid') {
      if (!createPaidTools) throw new Error('Paid research runtime unavailable');
      paidTools = await createPaidTools({ run, root, directory });
    }
    run.status = 'running'; await event('run-started', 'orchestrator', paidTools ? 'Janus supervisor started with authorized paid research tools.' : 'Janus supervisor started. Research only; no wallet or payment calls.');
    const vault = createWorkbenchStore(path.join(root, 'vault'));
    const infer = async (agent, step, prompt, purchased = []) => {
      if (run.artifacts[step]) { await event('artifact-reused', agent.id, 'Reused the saved response without another provider request.', { step }); return run.artifacts[step]; }
      if (await stopped()) throw new Error('DISPATCH_STOPPED');
      const intent = path.join(directory, digest(step) + '.intent.json');
      try {
        const handle = await fs.open(intent, 'wx', 0o600);
        try { await handle.writeFile(JSON.stringify({ step, agentId: agent.id, mode: run.mode, at: new Date().toISOString() })); await handle.sync(); } finally { await handle.close(); }
      }
      catch (e) { if (e.code === 'EEXIST') { run.status = 'reconciling'; throw new Error('Prior inference outcome uncertain. Reconcile provider history before any retry.'); } throw e; }
      await event('provider-requested', agent.id, run.mode === 'fixture' ? 'Local research requested; no provider billing.' : `Request submitted to the configured model.`, { step });
      let result;
      if (run.mode !== 'llm') {
        await new Promise(resolve => setTimeout(resolve, 250));
        result = { text: step === 'report' ? `${run.mode === 'paid' ? 'Local paid research report' : 'Research fixture report'}: ${run.question}\n\n${Object.values(run.artifacts).map(item => item.text).join('\n\n')}` : `${agent.name}: ${agent.responsibility}\nQuestion: ${run.question}\n${purchased.length ? 'Purchased source:\n' + purchased.map(item => item.content).join('\n') : 'Local fixture artifact; no external sources were fetched or purchased.'}`, provider: 'local-fixture', model: 'deterministic', requestId: null, usage: null };
      } else {
        // Resolve credentials at dispatch time, allowing revocation to stop future calls.
        const credential = await vault.credential(user, agent.credentialId);
        try { result = await providerCall({ credential, model: agent.model, prompt }); }
        catch (error) { run.status = 'reconciling'; throw error; }
      }
      run.artifacts[step] = { ...result, text: result.text.slice(0, 24000), agentId: agent.id, step, savedAt: new Date().toISOString() };
      await event('artifact-saved', agent.id, 'Response persisted as a checkpoint artifact.', { step, requestId: result.requestId });
      return run.artifacts[step];
    };
    const coordinator = run.config.agents.find(agent => agent.id === 'orchestrator');
    const plan = await infer(coordinator, 'plan', `Plan research for this question: ${run.question}\nRoles: ${JSON.stringify(run.config.agents.map(a => ({ name: a.name, responsibility: a.responsibility })))}\nUse only the supplied context; distinguish missing evidence from established facts.`);
    const workers = run.config.agents.filter(agent => agent.id !== 'orchestrator');
    const recover = async (agent, failedWorker) => {
      if (run.mode !== 'paid') {
        if (paidTools) await paidTools.replace(agent.id);
        await event('worker-replaced', agent.id, paidTools ? 'Replacement authority confirmed on chain; resuming original paid operations.' : 'Replacement resumes the saved local research checkpoint.');
        return true;
      }
      const state = run.workers[agent.id];
      state.status = 'waiting-replacement';
      await event('replacement-search', agent.id, 'Searching live Arkiv for an eligible replacement.');
      try {
        const result = await paidTools.replace(agent.id, failedWorker);
        if (result.assignment) {
          const { replacement, epoch, transaction, discovery } = result.assignment;
          state.status = 'replacing';
          await event('worker-replaced', agent.id, `Confirmed worker ${replacement} at epoch ${epoch} before resuming.`, {
            transaction, worker: replacement, epoch, entityKey: discovery?.selected?.entityKey,
          });
          return true;
        }
        await event('replacement-waiting', agent.id, 'No eligible live Arkiv worker found. Resume to check again.', { discovery: result.evidence });
      } catch {
        await event('replacement-waiting', agent.id, 'Replacement could not be confirmed. Check Arkiv and treasury status, then resume to retry.');
      }
      return false;
    };
    const launch = agent => new Promise((resolve, reject) => {
      const attempt = (run.workers[agent.id]?.attempt || 0) + 1;
      const worker = paidTools?.worker?.(agent.id);
      run.workers[agent.id] = { status: 'starting', attempt, pid: null, heartbeat: null, worker };
      const child = fork(fileURLToPath(new URL('./research-worker.mjs', import.meta.url)), [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: { PATH: process.env.PATH || '' }, execArgv: [] });
      children.add(child);
      let settled = false, inflight = Promise.resolve(), requestSeen = false, interrupted = false;
      let releaseCheckpoint;
      const signalReceived = action => hasControl(workerControl(directory, agent.id, attempt, action));
      const checkWorkerControl = async () => {
        if (settled || interrupted || !child.connected) return;
        if (await signalReceived('interrupt')) {
          interrupted = child.kill();
        } else if (releaseCheckpoint && (await signalReceived('continue') || await stopped())) {
          releaseCheckpoint();
        }
      };
      const finish = (error) => { if (settled) return; settled = true; children.delete(child); child.kill(); error ? reject(error) : resolve(); };
      child.on('message', message => {
        if (message.type === 'heartbeat') {
          run.workers[agent.id].heartbeat = new Date().toISOString();
          void checkWorkerControl().then(save).catch(finish);
          return;
        }
        if (message.type === 'request' && !requestSeen) {
          requestSeen = true;
          inflight = (async () => {
            if (await stopped()) { if (child.connected) child.send({ type: 'stop' }); return; }
            run.workers[agent.id] = { ...run.workers[agent.id], status: 'running', pid: child.pid, heartbeat: new Date().toISOString() };
            await event('worker-started', agent.id, 'Independent worker process started.', { pid: child.pid, attempt });
            let purchased = [];
            if (paidTools) {
              purchased = await paidTools.acquire(agent.id, async result => {
                await event('tool-payment-confirmed', agent.id, 'Paid research artifact confirmed.', { transaction: result.receipt.transaction });
                if (interruptAfterPaid && agent.id === workers[0].id && attempt === 1) {
                  await event('worker-interrupted', agent.id, 'Worker stopped after paid result, before checkpoint acknowledgement.');
                  const fault = new Error('PAID_WORKER_INTERRUPTED'); fault.code = 'PAID_WORKER_INTERRUPTED'; throw fault;
                }
              }, async result => {
                await event('paid-result-reused', agent.id, 'Paid result reused—no additional charge', { transaction: result.receipt.transaction });
              }).catch(error => { if (error.code === 'PAID_WORKER_INTERRUPTED') { child.kill(); return null; } throw error; });
              if (purchased === null) return;
              await event('paid-artifacts-ready', agent.id, 'Purchased artifacts loaded from durable task checkpoints.');
              if (run.holdPaidCheckpoint && agent.id === workers[0].id && attempt === 1 && child.connected) {
                clearTimeout(timeout);
                const checkpoint = new Promise(resolveCheckpoint => { releaseCheckpoint = resolveCheckpoint; });
                run.workers[agent.id].status = 'paid-checkpoint';
                await event('paid-checkpoint', agent.id, 'Source checkpoint saved. Interrupt the worker or continue.');
                await checkpoint;
                releaseCheckpoint = undefined;
                run.workers[agent.id].status = 'running';
              }
            }
            await checkWorkerControl();
            if (!child.connected || interrupted) return;
            if (await stopped()) { if (child.connected) child.send({ type: 'stop' }); return; }
            const artifact = await infer(agent, 'research:' + agent.id, `Question: ${run.question}\nResponsibility: ${agent.responsibility}\nCoordinator plan: ${plan.text}\nPurchased source material: ${JSON.stringify(purchased)}\nProduce concise findings based only on supplied material. State limitations and do not invent web access or citations.`, purchased);
            if (run.interrupt && agent.id === workers[0].id && attempt === 1) {
              await event('worker-interrupted', agent.id, 'Fixture interruption after checkpoint, before worker acknowledgement.');
              child.kill(); return;
            }
            if (child.connected) child.send({ type: 'result', text: artifact.text });
          })().catch(finish);
        }
        if (message.type === 'complete' && !interrupted) {
          inflight.then(async () => { run.workers[agent.id].status = 'completed'; await event('worker-completed', agent.id, 'Research branch completed.'); finish(); }).catch(finish);
        }
      });
      const timeout = setTimeout(() => finish(new Error('Worker response timeout; reconcile before resuming')), paidTools ? 180000 : 65000);
      child.once('error', finish);
      child.once('exit', () => {
        clearTimeout(timeout);
        releaseCheckpoint?.();
        if (settled) return;
        inflight.then(async () => {
          if (settled) return;
          children.delete(child); settled = true;
          if (interrupted) await event('worker-interrupted', agent.id, 'Worker process interrupted.', { pid: child.pid, attempt });
          if (await stopped()) {
            run.workers[agent.id].status = interrupted && run.mode === 'paid' ? 'waiting-replacement' : 'paused';
            await save(); resolve();
          } else if (run.mode === 'paid' || (attempt < 2 && (run.artifacts['research:' + agent.id] || paidTools))) {
            if (await recover(agent, worker) && !await stopped()) launch(agent).then(resolve, reject);
            else resolve();
          } else reject(new Error('Worker stopped; reconcile its saved checkpoint before retry'));
        }).catch(reject);
      });
      child.send({ type: 'start' });
    });
    // All branches settle before terminal state, so no provider call continues after failure is reported.
    const outcomes = await Promise.allSettled(workers.map(async agent => {
      const state = run.workers[agent.id];
      if (state?.status === 'completed') return;
      if (state?.status === 'waiting-replacement' && !await recover(agent, state.worker)) return;
      if (!await stopped()) await launch(agent);
    }));
    const failed = outcomes.find(outcome => outcome.status === 'rejected');
    if (failed) throw failed.reason;
    const waiting = Object.values(run.workers).some(worker => worker.status === 'waiting-replacement');
    if (!waiting && !await stopped()) {
      const sources = workers.map(agent => ({ agent: agent.name, artifact: run.artifacts['research:' + agent.id]?.text }));
      run.report = await infer(coordinator, 'report', `Answer the research question: ${run.question}\nSynthesize these worker findings: ${JSON.stringify(sources)}\nDistinguish evidence, uncertainties and missing external sources. ${paidTools ? 'Purchased sources were supplied to workers; distinguish them from model knowledge.' : 'No tool purchase has occurred.'}`);
    }
    const action = await control();
    run.status = action === 'cancel' ? 'cancelled' : action === 'pause' || waiting ? 'paused' : 'completed';
    await event('run-' + run.status, 'orchestrator', 'Run ' + run.status + '.');
    return run;
  } catch (error) {
    if (run) {
      let action; try { action = JSON.parse(await fs.readFile(path.join(directory, 'control.json'), 'utf8')).action; } catch { /* no control */ }
      run.status = error.message === 'DISPATCH_STOPPED' ? action === 'cancel' ? 'cancelled' : 'paused' : run.status === 'reconciling' ? 'reconciling' : 'failed';
      run.error = error.message;
      await queue.catch(() => {});
      run.events.push({ sequence: run.events.length + 1, at: new Date().toISOString(), type: 'run-' + run.status, agentId: 'orchestrator', summary: error.message });
      await atomic(path.join(directory, 'run.json'), run);
    }
    return run;
  } finally { for (const child of children) child.kill(); await lock.close(); await fs.unlink(lockPath); }
}
