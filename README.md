# Janus

Payment-aware recovery for agent workflows. Task budgets stay with the work while worker spending authority can be safely reassigned.

Public demo: [janus-puce.vercel.app](https://janus-puce.vercel.app).
The team will continue building Janus after Mumbai. Detached research workers
require a long-lived Node host; the hosted frontend alone does not establish
that all backend integrations are deployed.

Janus original source is available under the [MIT license](LICENSE). Dependencies,
fonts and third-party assets retain their own licenses; MIT does not relicense them.

## Build provenance and AI assistance

The team confirms Janus ideation and implementation began after ETHGlobal Mumbai
started and that the project is registered in the from-scratch track. ChatGPT
assisted development. Codex also assisted repository analysis, qualification
documentation, code changes, tests and demo automation. The team supplies product
requirements and submission decisions; AI output is not an independent audit.
The team has deferred the pre-existing code/assets declaration; no assertion about
those assets is made here. Intended selections: EF CROPS, Arkiv Build on Arkiv
(from scratch), and Hedera AI Agents That Pay. Final dashboard submission remains
a team action.

## CROPS

Privy sign-in is wallet-only: email login and automatic embedded-wallet creation
are disabled. Existing linked-account records are preserved. Retaining Privy does
not resolve the separate EF no-trackers qualification gap.

- **C — Censorship resistance:** Janus controls the hosted domain and research server; losing them stops hosted research, but a saved standalone recovery client uses the owner's wallet and a replaceable RPC directly. Recovery needs chain access, gas and task/operation records, not Janus, Privy, a relayer or Arkiv.
- **O — Open source:** Original Janus code is MIT licensed. Build and run from this repository with Node.js 22 and the setup below; independent recovery needs no vendor account. Hosted identity, live models and testnet publication require their respective external services.
- **P — Privacy:** Janus adds no analytics service, but Privy's SDK contains telemetry and whole-client tracker-free qualification remains open. Privy sees login/wallet metadata; the Janus server decrypts provider keys and stores private research inputs/artifacts; model providers see prompts; RPCs/indexers see IPs and queried addresses. Merchants see signed purchases, and chain/Arkiv metadata is public. Server storage enables detached research; it is an explicit privacy trade-off, not anonymity.
- **S — Security:** Owner signing keys stay in the user's wallet for browser recovery; server provider keys use identity-bound AES-256-GCM, while checkpoints are plaintext private host files. Trust the host/vault key, wallet, RPC/chain, token issuer and reviewed contract; contracts are unaudited. Cancellation preserves reservations, and uncertain payments stop for reconciliation. Local CLI signers must be protected by the operator.

Independent recovery instructions: [RECOVERY.md](shared/RECOVERY.md). Save both
recovery files before an outage, or build them from the public source. User-key
provider charges are separate from treasury USDC limits. Dependency and asset
licensing, server privacy and external service availability remain explicit
deployment responsibilities.

[CROPS recovery demo (WebM, under three minutes)](docs/evidence/crops/crops-recovery.webm)
shows actual local contracts and the static recovery page after dashboard shutdown.
[Network/assertion evidence](docs/evidence/crops/report.json) records local-only
recovery traffic. The wallet is an injected test adapter; no live funds are used.
The hosted Privy login SDK has analytics code: **whole-client tracker-free
qualification is not yet established for authenticated hosted login**. The
independent recovery build contains no Privy, analytics SDK, remote scripts or
remote media. Decorative third-party video requests have been removed from Janus.

## Project structure

```text
backend/     Hedera services, merchant/facilitator, settlement checks
frontend/    Next.js application, assets and wallet authentication
contracts/   Solidity treasury, compiler scripts, tests and proof evidence
shared/      Common product context, architecture and implementation plan
scripts/     Repository consistency checks (no live transactions)
.github/     CI verification on pushes and pull requests
docs/        One research dossier, archived references and historical evidence
```

Start with [shared context](shared/CONTEXT.md), [our plan](shared/PLAN.md), and [architecture/configuration](shared/ARCHITECTURE.md). Each executable module owns its package manifest and lockfile. Root scripts orchestrate the modules. `shared/` currently contains maintained context; network configuration, wire rules, independent accounting model and versioned ABI export live under `shared/`.

## Setup

Requires Node.js 22 and npm. `.nvmrc` selects the supported major version.

```sh
npm run setup
npm run dev
```

Open http://localhost:3000. Copy `frontend/.env.example` to `frontend/.env.local` for authentication, then configure `NEXT_PUBLIC_PRIVY_APP_ID`, optional `NEXT_PUBLIC_PRIVY_CLIENT_ID`, and server-only `PRIVY_VERIFICATION_KEY`. Local verification needs no credentials.

The root package only orchestrates commands; it has no application dependencies. `npm install` at the root is not a substitute for `npm run setup`. Each module has its own lockfile and `node_modules/`. Install frontend dependencies locally. The Next.js resolution root includes the repository for shared configuration; this does not move dependencies or build output out of `frontend/`.

## Docker Compose

Run `docker compose up --build --wait` to start the frontend, task-aware backend and persistent local blockchain with automatically deployed contracts. Open http://localhost:3000. See [Docker setup](shared/DOCKER.md) for optional login configuration, SDK smoke checks and volume lifecycle.

## Verify

```sh
npm run check
```

`check` validates repository/lockfile consistency, lints and typechecks the frontend, compiles contracts, runs tests, and builds the frontend. CI runs the same command after `setup`. `check:repo`, `lint`, `typecheck`, `contracts:compile`, `test`, `test:protocol`, and `build` are also independently runnable.

`prototype` is an alias for the test suites: actual contracts on an ephemeral local EVM, offline backend settlement checks, and frontend session-verification tests. It does not submit live transactions or demonstrate a complete browser-to-agent workflow. Fresh local contract reports go into ignored `contracts/phase0/artifacts/` and `contracts/phase1/artifacts/`; committed evidence remains a historical snapshot.

`npm run contracts:compile` generates local ABI/bytecode artifacts. `npm run test:treasury` runs only the Phase-1 treasury suite.

## Current status and next work

The financial core implements task-isolated caps, reservation/settlement/expiry, worker epochs, cancellation and owner recovery. The frontend uses wallet-only Privy sign-in and validated treasury reads/receipt-confirmed actions; illustrative accounting requires an explicit fixture toggle. Durable task-aware purchases, checkpointed replacement and paid research have bounded CLI/local proofs. Browser research execution remains separate from financial/discovery reassignment.

The shared network/ABI/version, canonical operation encoding, accounting model and independent owner recovery client are implemented. Supported contract semantics are documented in [the treasury interface](shared/TREASURY_INTERFACE.md). Current qualification work and unresolved gates are in [submission status](docs/SUBMISSION_STATUS.md); broader integration gates remain in [PLAN.md](shared/PLAN.md).

## Live backend and configuration

### Hedera x402 payment flow

The native exact reference path uses official `@x402/hedera` and `@x402/core`
2.30.0. Its endpoint is `GET http://127.0.0.1:4024/research-source`. An unpaid
request receives HTTP 402 plus `PAYMENT-REQUIRED`; the client checks its pinned
merchant/asset/maximum amount, signs a native `TransferTransaction`, and retries
with `PAYMENT-SIGNATURE`. The self-run facilitator verifies payer signatures,
transfer semantics and balances, adds its fee-payer signature, waits for consensus
SUCCESS, and returns HTTP 200 with `PAYMENT-RESPONSE`. It sponsors network fees.
The dedicated payer is allowlisted; a two-HBAR network-fee ceiling and durable
submission journal protect the reference facilitator. Replay reuses the original
transaction; uncertain submissions require reconciliation.

Run `npm run x402:test --prefix backend` for the official-SDK offline HTTP test
(consensus is mocked). For a bounded **live testnet** request and recorded video,
copy `backend/.env.hedera.example` to ignored `backend/.env.hedera`, configure the
five `HEDERA_X402_*` account/key fields using two funded ECDSA testnet accounts,
then run `npm run x402:live --prefix backend`. The merchant may be the facilitator.
The default payment is 10,000 tinybars (0.0001 test HBAR). Set
`JANUS_CHROMIUM_PATH` if using an existing Chromium. Public proof goes to
`docs/evidence/hedera-exact/`; signed intents remain private in `.merchant-state/`.
The completed-run guard prevents another payment after successful evidence.

Historical executor-path settlement:
[`0.0.11338859@1793968385.882027690` on HashScan](https://hashscan.io/testnet/transaction/0.0.11338859@1793968385.882027690),
with [settlement/transfer evidence](backend/hedera/evidence/live-settlement.json).
It is a recorded 0.02 test-USDC payment, **not proof of the newly added native
exact path**. The task-treasury signed quote/purchase adapter remains separate;
native exact payments do not enforce TaskTreasury caps or worker epochs.

Testnet credentials belong in ignored `backend/.env.hedera`. Compile contracts and install all modules before using live tooling. `npm run backend:serve` starts the restricted Phase-0 merchant/facilitator. Live commands may spend testnet funds; they are excluded from setup and local tests.

`backend/.env.hedera.example` documents the accepted configuration. For a new dedicated testnet instance, `npm run hedera:init --prefix backend` generates keys without overwriting an existing environment file. Preserve existing deployment evidence and journals before preparing another instance.

The Phase-0 authorization is 32 bytes; Phase-1 uses 96 bytes (task ID, operation ID, attempt). The old adapter cannot simply be pointed at the newer treasury. Reserved obligations survive handoff/cancellation; returned-to-reserve funds are distinct from owner withdrawals.

## Documentation and generated files

[shared/](shared/README.md) owns current project context. [docs/](docs/README.md) indexes research and archived material; superseded schedules and handoffs are not the current plan. Duplicate extracted dossier copies were consolidated with differing revisions preserved in archives.

Next.js generates **only `frontend/.next/`** for this layout. It is ignored build/cache output, not source; it can be deleted while the frontend is stopped and is recreated by `dev` or `build`. The stale root `.next/` was removed. Never copy build output into other modules.

This is a development prototype, not audited or production-ready software. Historical live evidence is not a fresh network verification.

macOS AppleDouble files (`._*`) are ignored by Git, ESLint and TypeScript. Do not commit them. If Git reports `non-monotonic index` for a `._pack-*.idx` file on an external drive, remove only the verified AppleDouble sidecar, never the real `.idx` or `.pack` file.

Independent owner recovery is documented in [shared/RECOVERY.md](shared/RECOVERY.md). The CLI defaults to a read-only plan, validates deployment identity and only submits transactions with an explicit execution flag and owner key. Its local proof is separate from the historical Hedera proof.

Run `npm run demo:handoff` after setup/compilation for the local four-task checkpoint/replacement proof. Observed evidence is saved under ignored `backend/.runner-state/demo/report.json`; see [RUNNER.md](shared/RUNNER.md) for scope and limitations.

## Sponsor verification and submission readiness

The [sponsor verification plan](docs/SPONSOR_VERIFICATION.md) maps official Hedera, EF CROPS and Arkiv requirements to meaningful product behavior, measurable pass/fail gates, removal experiments and reproducible reviewer evidence. The [evidence register](docs/evidence/sponsor-status.json) tracks open requirements without treating a working component as prize eligibility.

Run `npm run sponsors:check` to validate the register and local references; it does not rerun experiments. Run `npm run sponsors:ready` for the stricter internal submission gate, which currently fails because required evidence is missing. Recheck official rules, registered track/provenance, root FOSS license, AI attribution, actual x402 compliance and final public demo materials before submission. No track is currently marked submission-ready.

## Arkiv worker discovery

Run `npm run arkiv:query` to query public research-worker records independently of the Janus backend. Set up a dedicated funded Rabdi wallet with `backend/.env.arkiv.example`, then use `npm run arkiv:preflight` (read-only) and `npm run arkiv:publish` (test-gas write). Recorded funded publication is linked below; fresh writes require a locally configured funded signer. Writer addresses, entity keys and transaction hashes must come from actual runs.

`npm run demo:handoff` verifies discovery-driven replacement against a labelled fixture directory and local payments. `npm run demo:arkiv` explicitly publishes on Rabdi and uses live reads for that same local treasury/payment flow. It does not submit live Hedera payments. Read [the Arkiv setup guide](shared/ARKIV.md) for schema, owner policy, signed readiness, failure cases and evidence paths. The current adapter uses `janus-task-v1`; it is not a standard x402 compliance claim.

## Authoritative treasury dashboard and independent recovery

Overview/Tasks default to validated Hedera treasury reads. Click **Refresh chain state** and supply task IDs or a bounded event range when needed. Owner/scheduler actions wait for successful receipts; fixture accounting requires an explicit toggle. Frontend dev/build generate a standalone recovery copy at `/recovery/index.html`; save both HTML and JavaScript files for independent hosting. See [phase-six verification and limits](shared/PHASE6.md). Local Chromium verifies all four dashboard controls and recovery after the dashboard server stops. Manual live wallet recovery remains unverified.

## Live Arkiv worker directory

Dedicated Rabdi writer: `0xf4F1a10309FCb1514bF6b0eb1E4813E220D936F0` (chain `7794095`). Two one-hour entities were published by this one wallet: a Hedera-compatible profile and a local-handoff profile. The actual directory UI read the live Hedera-compatible record; the runner selected the live local-network record and completed paid-result reuse. See [publication/query/receipt/browser evidence](backend/arkiv/evidence/2026-11-07/README.md). Financial handoff and payments in that demonstration used a local EVM, not live Hedera.

Reproduce a current query: `npm run arkiv:query`. For local-demo execution-network records: `ARKIV_WORKER_NETWORK=eip155:1337 npm run arkiv:query`. Filters include `janus.worker.v2`, researcher/ready/research, execution network, `janus-task-v1` and an unexpired lease. Profiles expire; later empty results are expected unless intentionally republished. No private key is required for reads.
