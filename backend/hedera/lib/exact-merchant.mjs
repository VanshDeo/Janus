import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { ExactHederaScheme } from '@x402/hedera/exact/facilitator';
import { inspectHederaTransaction, isValidHederaEntityId, Transaction } from '@x402/hedera';
import { decodePaymentSignatureHeader, encodePaymentRequiredHeader, encodePaymentResponseHeader } from '@x402/core/http';
import { syncDirectory } from '../../lib/fs-durability.mjs';

const hash = text => createHash('sha256').update(text).digest('hex');
// Official native exact scheme. This is deliberately separate from TaskTreasury.
// A dedicated payer allowlist bounds this fee-sponsoring reference service.
export async function createExactMerchant({ signer, directory, payTo, allowedPayer, asset = '0.0.0', amount = '10000', url }) {
  const scheme = new ExactHederaScheme(signer);
  if (![payTo, allowedPayer, asset].every(isValidHederaEntityId) || payTo === allowedPayer
    || !/^[1-9][0-9]*$/.test(amount) || !url) throw new Error('Invalid exact merchant policy');
  const requirements = { scheme: 'exact', network: 'hedera:testnet', asset, amount, payTo,
    maxTimeoutSeconds: 120, extra: scheme.getExtra('hedera:testnet') };
  if (!requirements.extra?.feePayer || requirements.extra.feePayer === allowedPayer) throw new Error('Use distinct payer and facilitator accounts');
  const challenge = { x402Version: 2, resource: { url, description: 'Janus paid research reference data', mimeType: 'application/json' }, accepts: [requirements] };
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const serviceLock = await fs.open(path.join(directory, 'exact-service.lock'), 'wx', 0o600);
  const save = async (file, value) => {
    const handle = await fs.open(file + '.tmp', 'w', 0o600);
    try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(file + '.tmp', file);
    await syncDirectory(directory);
  };
  const check = payload => {
    if (payload.x402Version !== 2 || !isDeepStrictEqual(payload.accepted, requirements)
      || !isDeepStrictEqual(payload.resource, challenge.resource)) throw new Error('Payment scope mismatch');
    const inspected = inspectHederaTransaction(payload.payload.transaction);
    const transaction = Transaction.fromBytes(Buffer.from(payload.payload.transaction, 'base64'));
    if (!transaction.maxTransactionFee || BigInt(transaction.maxTransactionFee.toTinybars().toString()) > 200000000n) throw new Error('Network fee ceiling exceeded');
    const transfers = asset === '0.0.0' ? inspected.hbarTransfers : inspected.tokenTransfers[asset] ?? [];
    const senders = transfers.filter(entry => BigInt(entry.amount) < 0n);
    if (senders.length !== 1 || senders[0].accountId !== allowedPayer) throw new Error('Payer not allowed');
    return inspected;
  };
  let queue = Promise.resolve();
  const settle = payload => {
    const job = queue.then(async () => {
      const inspected = check(payload), fingerprint = hash(payload.payload.transaction);
      const file = path.join(directory, hash(inspected.transactionId) + '.json');
      let record;
      try { record = JSON.parse(await fs.readFile(file, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (record) {
        if (record.fingerprint !== fingerprint) throw new Error('Transaction fingerprint conflict');
        if (record.status === 'confirmed') return record.settlement;
        throw new Error('Prior submission uncertain; reconcile its transaction before retry');
      }
      const verified = await scheme.verify(payload, requirements);
      if (!verified.isValid) throw new Error('Exact scheme verification failed');
      // Persist before any network submission. Unknown outcomes never become unpaid.
      await save(file, { status: 'submitting', fingerprint, transactionId: inspected.transactionId });
      const settlement = await scheme.settle(payload, requirements);
      if (!settlement.success) throw new Error('Settlement uncertain; reconcile before retry');
      await save(file, { status: 'confirmed', fingerprint, settlement });
      return settlement;
    });
    queue = job.catch(() => {});
    return job;
  };
  return { requirements, challenge, settle,
    async close() { await queue; await serviceLock.close(); await fs.unlink(path.join(directory, 'exact-service.lock')); },
    handler: async (req, res) => {
      const json = (status, body, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers }); res.end(JSON.stringify(body)); };
      if (req.method !== 'GET' || req.url !== '/research-source') return json(404, { error: 'not_found' });
      const encoded = req.headers['payment-signature'];
      if (!encoded) return json(402, challenge, { 'PAYMENT-REQUIRED': encodePaymentRequiredHeader(challenge) });
      try {
        if (encoded.length > 32768) throw new Error('Payload too large');
        const settlement = await settle(decodePaymentSignatureHeader(encoded));
        return json(200, { source: 'Janus deterministic research reference', content: 'Task budgets preserve outstanding obligations across worker replacement.', settlement },
          { 'PAYMENT-RESPONSE': encodePaymentResponseHeader(settlement) });
      } catch { return json(402, { ...challenge, error: 'payment_rejected_or_reconciliation_required' }, { 'PAYMENT-REQUIRED': encodePaymentRequiredHeader(challenge) }); }
    },
  };
}
