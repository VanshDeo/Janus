import { hashScanTransaction } from '@/lib/payment-receipts.mjs';

export default function PaymentReceipt({ transaction, chainId, confirmed = false }: { transaction: string; chainId?: number; confirmed?: boolean }) {
  const url = hashScanTransaction(transaction, chainId);
  return <div className="agent-payment-receipt">
    <span>{confirmed ? 'Payment succeeded' : 'Transaction hash'}</span>
    <code className="agent-transaction-hash">{transaction}</code>
    {url && <a href={url} target="_blank" rel="noopener noreferrer" aria-label={`View transaction ${transaction} on HashScan`}>View on HashScan ↗</a>}
  </div>;
}
