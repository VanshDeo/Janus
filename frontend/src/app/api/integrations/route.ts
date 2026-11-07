import { createPublicClient, defineChain, http } from 'viem';
import network from '../../../../../shared/network.json' with { type: 'json' };
import deployment from '../../../../../shared/deployments/hedera-testnet.json' with { type: 'json' };

import { localDeployment } from '../../../../../backend/workbench/local-deployment.mjs';

export async function GET(request: Request) {
  const transaction = new URL(request.url).searchParams.get('receipt');
  if (!process.env.JANUS_MERCHANT_URL) return Response.json({ deployment: null }, { headers: { 'Cache-Control': 'no-store' } });
  if (transaction !== null && !/^0x[0-9a-fA-F]{64}$/.test(transaction)) return Response.json({ error: 'Invalid transaction hash' }, { status: 400 });
  try {
    const { manifest, publicClient } = await localDeployment();
    if (!transaction) return Response.json({ deployment: manifest, rpcPort: process.env.JANUS_RPC_PORT || '8545' }, { headers: { 'Cache-Control': 'no-store' } });
    const receipt = await publicClient.getTransactionReceipt({ hash: transaction as `0x${string}` });
    if (!receipt.logs.some(log => log.address.toLowerCase() === manifest.treasury.toLowerCase())) {
      return Response.json({ error: 'Treasury receipt unavailable' }, { status: 404 });
    }
    return new Response(JSON.stringify(receipt, (_, value) => typeof value === 'bigint' ? value.toString() : value, 2), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch { return Response.json({ error: 'Local treasury unavailable' }, { status: 502 }); }
}

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: 'Cross-origin request rejected' }, { status: 403 });
  try {
    if (process.env.JANUS_MERCHANT_URL) {
      const { manifest } = await localDeployment();
      return Response.json({ hedera: { chainId: manifest.chainId, deploymentPresent: true, treasury: manifest.treasury } });
    }
    const client = createPublicClient({ chain: defineChain({ ...network, id: network.chainId }), transport: http(network.rpcUrls.default.http[0], { timeout: 12000, retryCount: 0 }) });
    const chainId = await client.getChainId();
    const code = await client.getCode({ address: deployment.treasury as `0x${string}` });
    return Response.json({ hedera: { chainId, expectedChainId: network.chainId, deploymentPresent: Boolean(code && code !== '0x'),
      treasury: deployment.treasury, mode: 'Read-only testnet check; no payment submitted', x402Verified: false } }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return Response.json({ error: 'Treasury RPC check failed' }, { status: 502 }); }
}
