// Explicit live testnet command. Never imported by tests/setup/build.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { Client, PrivateKey, createClientHederaSigner, createHederaSignAndSubmitTransaction,
  createHederaVerifyPayerSignature, createHederaPreflightTransfer } from '@x402/hedera';
import { createExactMerchant } from '../lib/exact-merchant.mjs';
import { buyExactSource } from '../lib/exact-client.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const directory = path.join(root, 'backend/.merchant-state/native-exact');
const evidence = path.join(root, 'docs/evidence/hedera-exact');
const reportPath = path.join(evidence, 'report.json');
let merchant, server, browser, context;
try {
  try { const report = JSON.parse(await fs.readFile(reportPath, 'utf8')); if (report.status === 'passed') {
    console.log('Completed-run guard: existing native exact proof retained; no new payment.'); process.exit(0);
  } } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const env = path.join(root, 'backend/.env.hedera');
  try { process.loadEnvFile(env); } catch { throw new Error('Configure the dedicated testnet environment first'); }
  const required = name => { const value = process.env['HEDERA_X402_' + name]?.trim(); if (!value) throw new Error('Configure HEDERA_X402_' + name); return value; };
  const key = value => value.startsWith('0x') ? PrivateKey.fromStringECDSA(value.slice(2)) : PrivateKey.fromString(value);
  const payer = required('PAYER_ACCOUNT_ID'), feePayer = required('FEE_PAYER_ACCOUNT_ID'), payTo = required('MERCHANT_ACCOUNT_ID');
  const payerKey = key(required('PAYER_PRIVATE_KEY')), feeKey = key(required('FEE_PAYER_PRIVATE_KEY'));
  const asset = process.env.HEDERA_X402_ASSET || '0.0.0', amount = process.env.HEDERA_X402_AMOUNT || '10000';
  // Dedicated initial rehearsal is bounded to 0.0001 HBAR or 0.02 test USDC.
  if (!((asset === '0.0.0' && amount === '10000') || (asset === '0.0.429274' && amount === '20000'))) throw new Error('Only the bounded testnet proof amounts are supported');
  const buildClient = network => {
    if (network !== 'hedera:testnet') throw new Error('Testnet only');
    const client = Client.forTestnet().setOperator(feePayer, feeKey);
    client.setDefaultRegenerateTransactionId(false); client.setMaxAttempts(2);
    client.setGrpcDeadline(10000); client.setRequestTimeout(35000);
    return client;
  };
  const signer = { getAddresses: () => [feePayer],
    verifyPayerSignature: createHederaVerifyPayerSignature(), preflightTransfer: createHederaPreflightTransfer(),
    signAndSubmitTransaction: createHederaSignAndSubmitTransaction(buildClient, feeKey) };
  server = http.createServer((req, res) => merchant.handler(req, res));
  server.listen(4024, '127.0.0.1'); await once(server, 'listening');
  const endpoint = 'http://127.0.0.1:4024/research-source';
  merchant = await createExactMerchant({ signer, directory, payTo, allowedPayer: payer, asset, amount, url: endpoint });
  await fs.mkdir(evidence, { recursive: true });
  const { chromium } = await import('../../../contracts/node_modules/playwright/index.mjs');
  browser = await chromium.launch({ headless: true, ...(process.env.JANUS_CHROMIUM_PATH ? { executablePath: process.env.JANUS_CHROMIUM_PATH } : {}) });
  context = await browser.newContext({ viewport: { width: 1280, height: 900 }, recordVideo: { dir: evidence, size: { width: 1280, height: 900 } } });
  const recordingStartedAt = Date.now();
  const page = await context.newPage();
  await page.setContent('<html><body style="background:#101820;color:white;padding:35px;font:22px system-ui"><h1>Janus: LIVE Hedera testnet x402</h1><p>Official native exact SDK · automatic payer signing · facilitator pays gas</p><pre id="events" style="white-space:pre-wrap"></pre><a id="explorer" style="color:#8df"></a></body></html>');
  const events = [];
  const emit = async text => { events.push({ at: new Date().toISOString(), text }); console.log(text); await page.locator('#events').evaluate((node, text) => { node.textContent += text + '\n\n'; }, text); };
  await emit(`Policy: ${amount} base units of ${asset}; payer ${payer}; merchant ${payTo}.`);
  const intentPath = path.join(directory, 'client-intent.json');
  let savedPayload;
  try { savedPayload = JSON.parse(await fs.readFile(intentPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await emit('Starting autonomous GET /research-source. No human payment approval.');
  const options = { endpoint, signer: createClientHederaSigner(payer, payerKey), expected: { asset, payTo, feePayer, maxAmount: amount }, savedPayload,
    onEvent: async event => {
      if (event.type === 'challenge') await emit(`GET /research-source → HTTP ${event.status} PAYMENT-REQUIRED.`);
      if (event.type === 'quote-validated') await emit('Client verified the pinned merchant, asset, fee payer and price limit.');
      if (event.type === 'payment-response') await emit(`Paid request returned HTTP ${event.status}.`);
    },
    onPayload: async payload => {
      if (!savedPayload) {
        const file = await fs.open(intentPath, 'wx', 0o600); try { await file.writeFile(JSON.stringify(payload)); await file.sync(); } finally { await file.close(); }
        savedPayload = payload;
      }
      await emit('Native TransferTransaction signed automatically; saved intent before sending PAYMENT-SIGNATURE.');
    } };
  const first = await buyExactSource(options);
  const transaction = first.settlement.transaction;
  const hashscan = `https://hashscan.io/testnet/transaction/${transaction}`;
  await emit(`HTTP 200 · consensus SUCCESS · ${transaction}`);
  await page.locator('#explorer').evaluate((node, href) => { node.href = href; node.textContent = 'Verify payment on HashScan: ' + href; }, hashscan);
  const replay = await buyExactSource({ ...options, savedPayload });
  if (replay.settlement.transaction !== transaction) throw new Error('Replay changed transaction');
  await emit('Replay returns the ORIGINAL settled transaction. No second network submission.');
  // Independently check public Mirror Node record before publishing passed evidence.
  const mirrorId = transaction.replace('@', '-').replace(/\.(\d+)$/, '-$1');
  let mirror;
  for (let attempt = 0; attempt < 8; attempt++) {
    const response = await fetch(`https://testnet.mirrornode.hedera.com/api/v1/transactions/${mirrorId}`, { signal: AbortSignal.timeout(12000) });
    if (response.ok) { mirror = await response.json(); if (mirror.transactions?.some(row => row.result === 'SUCCESS')) break; }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  const success = mirror?.transactions?.find(row => row.result === 'SUCCESS' && row.name === 'CRYPTOTRANSFER');
  if (!success) throw new Error('Independent Mirror verification pending; retain original intent');
  const transfers = asset === '0.0.0' ? success.transfers : success.token_transfers?.filter(row => row.token_id === asset);
  const net = account => (transfers ?? []).filter(row => row.account === account).reduce((sum, row) => sum + BigInt(row.amount), 0n);
  if (net(payer) !== -BigInt(amount)) throw new Error('Independent payer debit mismatch');
  // When merchant == facilitator, the HBAR credit is reduced by network fees.
  if (asset !== '0.0.0' || payTo !== feePayer) { if (net(payTo) !== BigInt(amount)) throw new Error('Independent merchant credit mismatch'); }
  else if (net(payTo) !== BigInt(amount) - BigInt(success.charged_tx_fee)) throw new Error('Merchant credit minus facilitator fee mismatch');
  await emit('Independent Mirror Node confirms SUCCESS and exact payer debit. Public HashScan link above.');
  await page.waitForTimeout(3500);
  const recordingSeconds = (Date.now() - recordingStartedAt) / 1000;
  if (recordingSeconds >= 290) throw new Error('Recording exceeded submission budget; retain settled transaction');
  const video = page.video(); await context.close(); context = null;
  await video.saveAs(path.join(evidence, 'hedera-payment.webm')); await video.delete();
  await fs.writeFile(path.join(evidence, 'mirror.json'), JSON.stringify(mirror, null, 2));
  await fs.writeFile(reportPath, JSON.stringify({ status: 'passed', checkedAt: new Date().toISOString(), sdk: '@x402/hedera@2.30.0', network: 'hedera:testnet',
    asset, amount, payer, merchant: payTo, feePayer, transaction, hashscan, autonomous: true, recordingSeconds, replayTransaction: replay.settlement.transaction, events,
    scope: 'native exact transfer; separate from task-treasury enforcement' }, null, 2));
  console.log('Native exact proof/video saved. No signed payload or private key included in public evidence.');
} catch (error) {
  if (/^(Configure|Only the bounded|Testnet only)/.test(error.message)) console.error(error.message);
  else console.error('Native exact proof incomplete. Inspect the private journal and original transaction; do not create a replacement payment.');
  process.exitCode = 1;
} finally {
  await context?.close(); await browser?.close();
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await merchant?.close();
}
