// Browser acceptance uses the actual dashboard components with an isolated auth/local-run fixture.
// Production identity and route isolation are separately covered by frontend/test/research.test.mjs.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { build } from '../../contracts/node_modules/esbuild/lib/main.js';
import { chromium } from '../../contracts/node_modules/playwright/index.mjs';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createLocalPaidResearch, localRunBalances, readAgentRunHistory } from '../../backend/workbench/local-paid-research.mjs';
import { localDeployment, sourcePrice } from '../../backend/workbench/local-deployment.mjs';
import { GET as integrations } from '../src/app/api/integrations/route.ts';
import { defaultConfig, validateWorkbenchConfig } from '../../backend/workbench/config.mjs';
import { createRun, executeResearch, readRun, listRuns, controlRun } from '../../backend/workbench/research.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const directory = await fs.mkdtemp(path.join(root, 'contracts/phase1/artifacts/dashboard-browser-'));
let config = structuredClone(defaultConfig);
const paid = process.env.JANUS_VERIFY_PAID;
let createPaidTools = createLocalPaidResearch;
if (paid === 'fixture') {
  const key = generatePrivateKey(), { address } = privateKeyToAccount(key);
  process.env.ARKIV_WRITER_PRIVATE_KEY = key;
  let queries = 0;
  createPaidTools = options => createLocalPaidResearch({ ...options, arkiv: {
    async query() {
      if (++queries === 1) return { chainId: 7794095, block: '10', records: [] };
      return { chainId: 7794095, block: '10', records: [{
        entityKey: '0x' + 'ab'.repeat(32), address, owner: address, network: 'eip155:1337', role: 'researcher',
        scheme: 'janus-task-v1', status: 'ready', capabilities: ['research'], updatedAtBlock: '9',
        expiresAtBlock: '100', validUntil: String(Math.floor(Date.now() / 1000) + 300),
      }] };
    },
  } });
}
const user = 'did:privy:browser-fixture', pending = new Set();
const auth = `const token = async () => 'browser-fixture'; const noop = async () => {}; const auth = {ready:true,authenticated:true,configured:true,user:{id:'fixture'},getAccessToken:token,walletAddress:null,walletType:null,chainId:null,error:null,login:noop,logout:noop}; export const useRelayAuth = () => auth; export const targetChain = {id:296};`;
await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import Dashboard from './src/components/dashboard-shell'; createRoot(document.getElementById('root')).render(<Dashboard initialTab="Agents"/>);`, resolveDir: path.join(root, 'frontend'), loader: 'tsx' }, bundle: true, format: 'esm', jsx: 'automatic', outfile: path.join(directory, 'bundle.js'), alias: { '@': path.join(root, 'frontend/src') }, plugins: [{ name: 'fixture-boundary', setup(build) {
  build.onResolve({ filter: /privy-auth-context/ }, () => ({ path: 'auth', namespace: 'fixture' }));
  build.onResolve({ filter: /^next\/(link|navigation|image)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
  build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path === 'auth' ? auth : args.path === 'next/navigation' ? 'export const useRouter = () => ({replace:()=>{}});' : args.path === 'next/image' ? `import React from 'react'; export default function Image({priority,...props}){return React.createElement('img',props)}` : `import React from 'react'; export default function Link(props){return React.createElement('a',props)}`, loader: 'jsx', resolveDir: path.join(root, 'frontend') }));
} }] });
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/workbench') {
      if (req.method === 'POST') { let raw=''; for await(const chunk of req) raw+=chunk; const body=JSON.parse(raw); if(body.action==='saveConfig') config=validateWorkbenchConfig(body.config); }
      res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({ config, credentials: [] })); return;
    }
    if (url.pathname === '/api/integrations') {
      const response = await integrations(new Request(url));
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(await response.text());
      return;
    }
    if (url.pathname === '/api/research') {
      const agentId = url.searchParams.get('agentId');
      const launch = id => {
        const promise = executeResearch({ root: directory, user, id, createPaidTools });
        pending.add(promise);
        promise.finally(() => pending.delete(promise));
      };
      let data;
      if (req.method === 'POST') {
        let raw=''; for await(const chunk of req) raw+=chunk; const body=JSON.parse(raw);
        if (body.action === 'create') {
          const deployment = paid && body.mode === 'paid' ? (await localDeployment()).manifest : undefined;
          const run = await createRun(directory, user, { ...body, config, deployment });
          launch(run.id);
          data = { run };
        } else {
          data = { run: await controlRun(directory, user, body.id, body.action, body) };
          if (body.action === 'resume') launch(body.id);
        }
      } else if (url.searchParams.has('id')) {
        const run = await readRun(directory, user, url.searchParams.get('id'));
        if (agentId) data = { history: await readAgentRunHistory(run, agentId) };
        else {
          if (run.mode === 'paid') run.tasks = await localRunBalances(run);
          data = { run };
        }
      } else data = { runs: await listRuns(directory, user, agentId), paidSourcePrice: paid ? sourcePrice : null };
      res.setHeader('Content-Type','application/json'); res.end(JSON.stringify(data)); return;
    }
    if (url.pathname.startsWith('/assets/')) { res.setHeader('Content-Type', 'image/webp'); res.end(await fs.readFile(path.join(root, 'frontend/public', url.pathname))); return; }
    if (url.pathname === '/landing.css') { res.setHeader('Content-Type','text/css'); res.end(await fs.readFile(path.join(root,'frontend/src/app/landing.css'))); return; }
    if (url.pathname === '/bundle.js' || url.pathname === '/bundle.css') { res.setHeader('Content-Type',url.pathname.endsWith('.js')?'text/javascript':'text/css'); res.end(await fs.readFile(path.join(directory,url.pathname.slice(1)))); return; }
    res.setHeader('Content-Type','text/html'); res.end('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/landing.css"><link rel="stylesheet" href="/bundle.css"><style>body{margin:0;background:#08090b;font-family:Arial,sans-serif}*{box-sizing:border-box}</style></head><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>');
  } catch(e) { res.statusCode=400;res.end(JSON.stringify({error:e.message})); }
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser = await chromium.launch({ headless:true, ...(process.env.JANUS_CHROMIUM_PATH ? { executablePath:process.env.JANUS_CHROMIUM_PATH } : {}) });
try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}}), errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://**/*',route=>route.abort());
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole('button',{name:'Create agent',exact:true}).click();
  await page.getByLabel('Name',{exact:true}).fill('Evidence reviewer');
  await page.getByLabel('Research responsibility').fill('Review supplied evidence and identify unsupported conclusions.');
  await page.getByRole('button',{name:'Save agent',exact:true}).click();
  await page.getByRole('button',{name:'View history for Evidence reviewer',exact:true}).click();
  const reviewerHistory = page.getByRole('dialog', { name: 'Evidence reviewer history' });
  await reviewerHistory.getByText('This agent has no saved runs.').waitFor();
  await page.keyboard.press('Escape');
  await reviewerHistory.waitFor({ state: 'hidden' });
  assert.equal(await page.getByRole('button', { name: /^View history for / }).count(), 5);
  await page.getByRole('button',{name:'Runs',exact:true}).click();
  if (paid) await page.getByLabel('Execution mode').selectOption('paid');
  await page.getByRole('button',{name:'Start run',exact:true}).click();
  if (paid) {
    await page.getByRole('button', { name: 'Continue worker' }).waitFor({ timeout: 40000 });
    const card = page.locator('article').filter({ has: page.getByRole('button', { name: 'Continue worker' }) });
    assert.equal(await card.locator('dt').filter({ hasText: /^Spent$/ }).locator('..').locator('dd').textContent(), sourcePrice);
    await card.getByRole('button', { name: 'Interrupt worker' }).click();
    if (paid === 'fixture') {
      await page.getByText('No eligible live Arkiv worker found. Resume to check again.', { exact: true }).waitFor();
      const [paused] = await listRuns(directory, user);
      assert.equal(paused.workers.alpha.attempt, 1);
      const resume = page.getByRole('button', { name: 'Resume', exact: true });
      await resume.click();
    }
    const replay = page.locator('li').filter({ hasText: 'Paid result reused—no additional charge' });
    await replay.waitFor({ timeout: 60000 });
    const receiptPath = await replay.getByRole('link', { name: 'View transaction receipt' }).getAttribute('href');
    const receipt = await page.request.get(new URL(receiptPath, page.url()).href);
    assert.equal(receipt.status(), 200);
    assert.equal((await receipt.json()).status, 'success');
    const [run] = await listRuns(directory, user);
    const agent = run.events.find(event => event.type === 'worker-interrupted');
    const assignment = run.events.find(event => event.type === 'worker-replaced');
    const paidEvent = run.events.find(event => event.type === 'tool-payment-confirmed' && event.agentId === agent.agentId);
    const reusedEvent = run.events.find(event => event.type === 'paid-result-reused' && event.agentId === agent.agentId);
    assert.equal(assignment.epoch, '2');
    assert.ok(assignment.entityKey);
    assert.ok(assignment.sequence < run.events.find(event => event.type === 'worker-started' && event.agentId === agent.agentId && event.attempt === 2).sequence);
    assert.equal(reusedEvent.transaction, paidEvent.transaction);
    assert.throws(() => process.kill(agent.pid, 0), { code: 'ESRCH' });
    const task = (await localRunBalances(run))[agent.agentId];
    assert.equal(task.epoch, '2');
    assert.equal(task.worker.toLowerCase(), assignment.worker.toLowerCase());
    assert.equal(task.spent, sourcePrice);
    assert.equal(task.available, '0');
    assert.equal(task.reserved, '0');
  }
  await page.getByRole('heading',{name:'Final report',exact:true}).waitFor({timeout:20000});
  await page.getByRole('button', { name: 'View history for Alpha', exact: true }).click();
  const alphaHistory = page.getByRole('dialog', { name: 'Alpha history' });
  await alphaHistory.getByRole('region', { name: 'Agent activity' }).getByText('worker started', { exact: true }).first().waitFor();
  const ledger = alphaHistory.getByRole('region', { name: 'Task transactions' });
  if (paid) {
    for (const label of ['Task created', 'Budget reserved', 'Payment settled', 'Worker assigned']) {
      const item = ledger.getByRole('listitem').filter({ hasText: label });
      const link = item.getByRole('link', { name: /View transaction receipt/ });
      assert.match(await link.innerText(), /^0x[0-9a-f]{64}$/i);
      const receipt = await page.request.get(new URL(await link.getAttribute('href'), page.url()).href);
      assert.equal(receipt.status(), 200);
      assert.equal((await receipt.json()).transactionHash, await link.innerText());
    }
  } else await ledger.getByText('No confirmed task transactions for this run.').waitFor();
  await alphaHistory.getByRole('button', { name: 'Close agent history' }).click();
  await page.getByLabel('Filter activity by agent').selectOption('alpha');
  if (!paid) assert.ok(await page.getByText('artifact reused',{exact:true}).count());
  await page.getByLabel('Filter activity by agent').selectOption('all');
  assert.equal(await page.locator('.unified-sidebar').count(),1);
  assert.equal(await page.locator('.unified-topbar').count(),1);
  await page.screenshot({path:path.join(directory,'desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:path.join(directory,'mobile.png'),fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('Dashboard browser acceptance passed: original shell, agent creation, parallel run, checkpoint replacement, event filtering, final report and responsive rendering.');
  if (paid) console.log(`Paid dashboard verified with ${paid === 'live' ? 'live Rabdi' : 'directory fixture'}: local settlement, worker interruption, confirmed reassignment and original receipt reuse.`);
  console.log('Screenshots: '+directory);
} finally {
  await browser.close();
  for (const run of await listRuns(directory, user)) {
    if (['running', 'queued', 'paused'].includes(run.status)) await controlRun(directory, user, run.id, 'cancel').catch(() => {});
  }
  await Promise.allSettled([...pending]);
  await new Promise(resolve => server.close(resolve));
}
