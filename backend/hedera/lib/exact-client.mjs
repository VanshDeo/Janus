import { ExactHederaScheme } from '@x402/hedera/exact/client';
import { decodePaymentRequiredHeader, encodePaymentSignatureHeader, decodePaymentResponseHeader } from '@x402/core/http';

// Endpoint comes from trusted task configuration, never arbitrary model output.
// Quote checks occur before signing; there is no interactive approval in this flow.
export async function buyExactSource({ endpoint, signer, expected, onPayload = async () => {}, onEvent = async () => {}, savedPayload }) {
  const url = new URL(endpoint);
  if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) throw new Error('Use HTTPS or localhost');
  const request = headers => fetch(endpoint, { headers, redirect: 'error', signal: AbortSignal.timeout(120000) });
  const initial = await request();
  if (initial.status !== 402) throw new Error('Expected HTTP 402 challenge');
  await onEvent({ type: 'challenge', status: initial.status });
  const challenge = decodePaymentRequiredHeader(initial.headers.get('payment-required'));
  const accepted = challenge.accepts?.find(option => option.scheme === 'exact' && option.network === 'hedera:testnet'
    && option.asset === expected.asset && option.payTo === expected.payTo && option.extra?.feePayer === expected.feePayer
    && /^[1-9][0-9]*$/.test(option.amount) && BigInt(option.amount) <= BigInt(expected.maxAmount));
  if (challenge.x402Version !== 2 || challenge.resource?.url !== endpoint || !accepted) throw new Error('Quote exceeds configured policy');
  await onEvent({ type: 'quote-validated' });
  const payload = savedPayload ?? { ...await new ExactHederaScheme(signer).createPaymentPayload(2, accepted), accepted, resource: challenge.resource };
  if (JSON.stringify(payload.accepted) !== JSON.stringify(accepted)) throw new Error('Saved payment quote changed; reconcile the original intent');
  await onPayload(payload); // Private durable intent, not public evidence.
  const response = await request({ 'PAYMENT-SIGNATURE': encodePaymentSignatureHeader(payload) });
  await onEvent({ type: 'payment-response', status: response.status });
  if (response.status !== 200) throw new Error('Payment failed or uncertain; reuse saved intent, never blindly create another');
  const settlement = decodePaymentResponseHeader(response.headers.get('payment-response'));
  if (!settlement.success || settlement.network !== 'hedera:testnet' || !settlement.transaction) throw new Error('Missing settlement proof');
  return { status: response.status, settlement, data: await response.json() };
}
