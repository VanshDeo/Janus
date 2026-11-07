import { createPublicClient, http } from 'viem';
import { chain, account } from '../docker/common.mjs';
import { validateTreasury } from '../../contracts/phase1/lib/recovery.mjs';
import { merchantEndpoint } from '../hedera/lib/transaction-policy.mjs';

export const sourcePrice = '20000';
export const sourceId = 'janus-task-treasury-v1';

export async function localDeployment(expected) {
 const endpoint = process.env.JANUS_MERCHANT_URL;
 if (!endpoint) throw new Error('Local paid research is unavailable');
 const response = await fetch(new URL('/deployment', merchantEndpoint(endpoint, { local: true })), {
  signal: AbortSignal.timeout(5000), redirect: 'error',
 });
 if (!response.ok) throw new Error('Local merchant deployment unavailable');
 const manifest = await response.json();
 if (manifest.mode !== 'local' || manifest.chainId !== chain.id || manifest.merchant !== account(3).address
     || manifest.worker !== account(1).address || manifest.owner !== account(0).address) throw new Error('Unexpected local deployment');
 for (const key of ['chainId', 'treasury', 'token', 'merchant', 'owner', 'runtimeCodeHash']) {
  if (expected && expected[key] !== manifest[key]) throw new Error('Run belongs to a different local deployment');
 }
 const transport = http(process.env.JANUS_RPC_URL, { timeout: 5000, retryCount: 0 });
 const publicClient = createPublicClient({ chain, transport, cacheTime: 0 });
 const read = await validateTreasury(publicClient, manifest);
 return { manifest, publicClient, endpoint, read, transport };
}
