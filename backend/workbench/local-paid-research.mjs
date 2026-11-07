import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createWalletClient, keccak256, stringToHex } from 'viem';
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

export async function createLocalPaidResearch({ run, root, directory, arkiv = createArkivDirectory() }) {
 const { manifest, publicClient, endpoint, read, transport } = await localDeployment(run.deployment);
 const wallet = signer => createWalletClient({ chain, transport, account: signer });
 const owner = wallet(account(0)), initial = wallet(account(1));
 const key = process.env.ARKIV_WRITER_PRIVATE_KEY;
 const replacement = key ? wallet(privateKeyToAccount(key)) : null;
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
   result[agentId] = { runner, walletClient, withSigner, async replace(failedWorker) {
    const authorize = address => same(replacement?.account.address, address);
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
     return { ...handoff, walletClient: replacement, assignment };
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
