import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createWalletClient, formatLog, keccak256, parseEventLogs, stringToHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { taskSnapshot } from '../../shared/protocol.mjs';
import { account, chain } from '../docker/common.mjs';
import { createArkivDirectory } from '../arkiv/directory.mjs';
import { handoffFromArkiv } from '../arkiv/discovery.mjs';
import { createCheckpointRunner } from '../runner/checkpoint-runner.mjs';
import { taskTreasuryAbi as abi } from '../hedera/lib/treasury.mjs';
import { acquireSignerLock } from '../hedera/lib/signer-lock.mjs';
import { requestHash } from '../hedera/lib/task-merchant.mjs';
import { createPaidResearchTools } from './paid-research.mjs';
import { localDeployment, sourceId, sourcePrice } from './local-deployment.mjs';

const taskId = (run, agentId) => keccak256(stringToHex(JSON.stringify(['janus-dashboard-research-v1', run.id, agentId])));
const workerIds = run => run.config.agents.filter(agent => agent.id !== 'orchestrator').map(agent => agent.id);
const same = (a, b) => a?.toLowerCase() === b?.toLowerCase();

export async function localRunBalances(run) {
 const { read } = await localDeployment(run.deployment);
 return Object.fromEntries(await Promise.all(workerIds(run).map(async agentId => {
  const id = taskId(run, agentId);
  const task = taskSnapshot(await read('tasks', [id]));
  return [agentId, task.cap === '0' ? null : { ...task, id }];
 })));
}

export async function readAgentRunHistory(run, agentId) {
 const events = run.events.filter(event => event.agentId === agentId);
 if (run.mode !== 'paid' || agentId === 'orchestrator') return { events, transactions: [] };
 try {
  const { manifest, publicClient } = await localDeployment(run.deployment);
  const id = taskId(run, agentId);
  // Each task event indexes its task ID in the second topic, including on older runs.
  const logs = await publicClient.request({ method: 'eth_getLogs', params: [{
   address: manifest.treasury, topics: [null, id], fromBlock: '0x0', toBlock: 'latest',
  }] });
  const transactions = parseEventLogs({ abi, logs: logs.map(log => formatLog(log)), strict: true })
   .filter(log => log.args.taskId === id && !log.removed)
   .sort((a, b) => a.blockNumber === b.blockNumber ? b.logIndex - a.logIndex : a.blockNumber > b.blockNumber ? -1 : 1)
   .map(log => ({ type: log.eventName, transaction: log.transactionHash, block: log.blockNumber.toString(), index: log.logIndex }));
  return { events, transactions };
 } catch {
  return { events, transactions: [], treasuryUnavailable: true };
 }
}

export async function createLocalPaidResearch({ run, root, directory, arkiv = createArkivDirectory(), onWorkerTransaction = async () => {} }) {
 const { manifest, publicClient, endpoint, read, transport } = await localDeployment(run.deployment);
 const wallet = signer => createWalletClient({ chain, transport, account: signer });
 const owner = wallet(account(0)), initial = wallet(account(1));
 const key = process.env.ARKIV_WRITER_PRIVATE_KEY;
 const replacement = key ? wallet(privateKeyToAccount(key)) : null;
 const trackTransactions = (client, agentId) => ({
  ...client,
  async writeContract(args) {
   const transaction = await client.writeContract(args);
   await onWorkerTransaction(agentId, transaction);
   return transaction;
  },
 });
 const signerDirectory = path.join(root, 'signers');
 const withSigner = async (client, operation) => {
  let unlock;
  for (let attempt = 0; !unlock; attempt++) {
   try { unlock = acquireSignerLock(signerDirectory, client.account.address); }
   catch (error) {
    if (error.cause?.code !== 'EEXIST' || attempt >= 120) throw error;
    await delay(250);
   }
  }
  try { return await operation(); } finally { unlock(); }
 };
 const amount = BigInt(sourcePrice);
 const request = { chainId: String(chain.id), treasury: manifest.treasury, token: manifest.token, merchant: manifest.merchant,
  amount: sourcePrice, route: '/dataset', body: { dataset: sourceId } };
 const validateResult = result => {
  const source = JSON.parse(result.result);
  return source.requestHash === requestHash(request) && source.dataset?.id === sourceId
   && Array.isArray(source.dataset.findings) && source.dataset.findings.length > 0;
 };
 const confirmed = async hash => {
  if ((await publicClient.waitForTransactionReceipt({ hash })).status !== 'success') throw new Error('Local treasury transaction reverted');
 };
 const bindings = await withSigner(owner, async () => {
  const result = {}, pending = [];
  for (const agentId of workerIds(run)) {
   const id = taskId(run, agentId), task = taskSnapshot(await read('tasks', [id]));
   if (task.cap === '0') pending.push(id);
   else if (task.cap !== sourcePrice || !same(task.merchant, manifest.merchant) || task.cancelled) throw new Error('Run treasury task is incompatible or cancelled');
   const walletClient = task.cap === '0' || same(task.worker, initial.account.address) ? initial : replacement;
   if (!walletClient || (task.cap !== '0' && !same(walletClient.account.address, task.worker))) throw new Error('No configured signer for the assigned worker');
   const runner = createCheckpointRunner({ directory: path.join(directory, 'paid'), publicClient, manifest, endpoint, taskId: id,
    steps: [{ id: 'treasury-reference', request }], validateResult, localMerchant: true });
   result[agentId] = { runner, walletClient: trackTransactions(walletClient, agentId), withSigner, async replace(failedWorker) {
    const authorize = address => same(replacement?.account.address, address)
     && ![manifest.owner, manifest.merchant, manifest.worker].some(reserved => same(reserved, address));
    const probe = async ({ message }) => ({ busy: false, signature: await replacement.signMessage({ message }) });
    return withSigner(owner, async () => {
     const handoff = await handoffFromArkiv({ runner, directory: arkiv, publicClient, manifest, taskId: id,
      schedulerWallet: owner, authorize, probe, failedWorker });
     if (!handoff.state) return handoff;
     const assignment = handoff.state.handoff;
     if (!authorize(assignment.replacement)) throw new Error('Confirmed replacement signer is unavailable');
     if (await publicClient.getBalance({ address: replacement.account.address }) === 0n) {
      await confirmed(await owner.sendTransaction({ to: replacement.account.address, value: 10n ** 16n }));
     }
     return { ...handoff, walletClient: trackTransactions(replacement, agentId), assignment };
    });
   } };
  }
  if (await read('unallocated') < BigInt(pending.length) * amount) throw new Error('Local treasury has insufficient unallocated funds for this run');
  for (const id of pending) {
   await confirmed(await owner.writeContract({ address: manifest.treasury, abi, functionName: 'createTask',
    args: [id, initial.account.address, manifest.merchant, amount, amount] }));
  }
  return result;
 });
 return createPaidResearchTools(bindings);
}
