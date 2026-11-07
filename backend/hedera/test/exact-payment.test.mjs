import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { PrivateKey, Transaction, createClientHederaSigner, inspectHederaTransaction } from '@x402/hedera';
import { createExactMerchant } from '../lib/exact-merchant.mjs';
import { buyExactSource } from '../lib/exact-client.mjs';

test('official Hedera exact SDK: autonomous HTTP 402, signature checks and durable replay', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'janus-exact-'));
  const key = PrivateKey.generateECDSA(), payer = '0.0.1002', feePayer = '0.0.1001', payTo = feePayer;
  const signer = createClientHederaSigner(payer, key, { network: 'hedera:testnet' });
  let submissions = 0, outcome = 'success';
  const facilitator = {
    getAddresses: () => [feePayer],
    verifyPayerSignature: async ({ transaction, payer: address }) => ({ ok: address === payer && key.publicKey.verifyTransaction(Transaction.fromBytes(Buffer.from(transaction, 'base64'))) }),
    preflightTransfer: async () => ({ ok: true }), // Offline fixture: no balance/consensus claim.
    signAndSubmitTransaction: async transaction => {
      submissions++;
      if (outcome === 'unknown') throw new Error('Fixture response lost');
      return { transactionId: inspectHederaTransaction(transaction).transactionId };
    },
  };
  let merchant;
  const server = http.createServer((req, res) => merchant.handler(req, res));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const endpoint = `http://127.0.0.1:${server.address().port}/research-source`;
  merchant = await createExactMerchant({ signer: facilitator, directory, payTo, allowedPayer: payer, url: endpoint });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await merchant.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const expected = { asset: '0.0.0', payTo, feePayer, maxAmount: '10000' };
  let payload;
  const first = await buyExactSource({ endpoint, signer, expected, onPayload: async value => { payload = value; } });
  assert.equal(first.status, 200); assert.equal(submissions, 1);
  assert.ok(payload.payload.transaction); assert.equal(payload.accepted.extra.feePayer, feePayer);
  const decoded = inspectHederaTransaction(payload.payload.transaction);
  assert.equal(decoded.transactionIdAccountId, feePayer);
  assert.deepEqual(decoded.hbarTransfers.map(entry => [entry.accountId, entry.amount]).sort(), [[feePayer, '10000'], [payer, '-10000']].sort());
  const replay = await buyExactSource({ endpoint, signer, expected, savedPayload: payload });
  assert.deepEqual(replay, first); assert.equal(submissions, 1);
  await merchant.close();
  merchant = await createExactMerchant({ signer: facilitator, directory, payTo, allowedPayer: payer, url: endpoint });
  assert.deepEqual(await buyExactSource({ endpoint, signer, expected, savedPayload: payload }), first);
  assert.equal(submissions, 1);
  await assert.rejects(buyExactSource({ endpoint, signer, expected: { ...expected, maxAmount: '9999' } }), /policy/);
  const invalidSignature = createClientHederaSigner(payer, PrivateKey.generateECDSA());
  await assert.rejects(buyExactSource({ endpoint, signer: invalidSignature, expected }), /uncertain/);
  assert.equal(submissions, 1, 'Wrong-key signatures must not reach submission');
  const changed = structuredClone(payload); changed.accepted.payTo = payer;
  await assert.rejects(merchant.settle(changed), /scope/);
  const unsigned = Transaction.fromBytes(Buffer.from(payload.payload.transaction, 'base64'));
  // A separately signed transaction from an unapproved payer must fail closed.
  const stranger = createClientHederaSigner('0.0.1004', PrivateKey.generateECDSA());
  await assert.rejects(buyExactSource({ endpoint, signer: stranger, expected }), /uncertain/);
  assert.equal(submissions, 1); assert.ok(unsigned);
  outcome = 'unknown';
  let uncertain;
  await assert.rejects(buyExactSource({ endpoint, signer, expected, onPayload: async value => { uncertain = value; } }), /uncertain/);
  assert.equal(submissions, 2);
  await assert.rejects(buyExactSource({ endpoint, signer, expected, savedPayload: uncertain }), /uncertain/);
  assert.equal(submissions, 2, 'An uncertain outcome must never resubmit');
});
