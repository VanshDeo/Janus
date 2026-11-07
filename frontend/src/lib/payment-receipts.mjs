const hashPattern = /^0x[0-9a-fA-F]{64}$/;
const settledEvents = new Set(['tool-payment-confirmed', 'tool-result-reused', 'paid-result-reused']);
export function hashScanTransaction(transaction, chainId) {
  if (!hashPattern.test(transaction ?? '')) return null;
  if (chainId === 296) return `https://hashscan.io/testnet/transaction/${transaction}`;
  return null; // Local EVM receipts must never be linked to Hedera.
}
export function agentPaymentReceipts(events, agentId, payments = [], taskId) {
  const receipts = new Map();
  for (const event of events) {
    if (event.agentId === agentId && settledEvents.has(event.type) && hashPattern.test(event.transaction ?? '')) {
      receipts.set(event.transaction.toLowerCase(), { transaction: event.transaction });
    }
  }
  for (const payment of payments) {
    if (taskId && payment.taskId?.toLowerCase() === taskId.toLowerCase() && hashPattern.test(payment.transaction ?? '')) {
      receipts.set(payment.transaction.toLowerCase(), { transaction: payment.transaction });
    }
  }
  return [...receipts.values()];
}
