import test from 'node:test';
import assert from 'node:assert/strict';
import { agentPaymentReceipts, hashScanTransaction } from '../src/lib/payment-receipts.mjs';
const hash = '0x' + 'a'.repeat(64), other = '0x' + 'b'.repeat(64);
test('each agent gets only successful payments; replay does not duplicate a receipt', () => {
  const events = [
    { agentId: 'alpha', type: 'reservation-submitted', transaction: other },
    { agentId: 'alpha', type: 'tool-payment-confirmed', transaction: hash },
    { agentId: 'alpha', type: 'paid-result-reused', transaction: hash },
    { agentId: 'beta', type: 'tool-payment-confirmed', transaction: other },
    { agentId: 'alpha', type: 'tool-payment-confirmed', transaction: 'invalid' },
  ];
  assert.deepEqual(agentPaymentReceipts(events, 'alpha'), [{ transaction: hash }]);
  assert.deepEqual(agentPaymentReceipts(events, 'beta'), [{ transaction: other }]);
  assert.deepEqual(agentPaymentReceipts(events, 'gamma'), []);
  assert.deepEqual(agentPaymentReceipts([], 'alpha', [{ taskId: 'task-a', transaction: hash }, { taskId: 'task-b', transaction: other }], 'task-a'), [{ transaction: hash }]);
});
test('HashScan links use confirmed network identity and valid hashes', () => {
  assert.equal(hashScanTransaction(hash, 296), 'https://hashscan.io/testnet/transaction/' + hash);
  assert.equal(hashScanTransaction(hash, 1337), null);
  assert.equal(hashScanTransaction(hash, undefined), null);
  assert.equal(hashScanTransaction('javascript:alert(1)', 296), null);
});
