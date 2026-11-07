# Native Hedera x402 exact

Official specification: https://docs.hedera.com/solutions/ai/x402/exact-scheme
Official packages: `@x402/hedera` and `@x402/core`, pinned to 2.30.0.

`backend/hedera/lib/exact-merchant.mjs` protects a research-reference endpoint
using the official facilitator scheme. `exact-client.mjs` consumes its HTTP 402
challenge and signs via the official client scheme. Policy pins testnet, asset,
recipient, facilitator and maximum amount before signing. The facilitator only
sponsors a configured payer and caps the serialized transaction fee at two HBAR.
Payer keys are local CLI secrets; no browser approval, signup or API key is used
in the paid HTTP exchange. Operators provision keys before execution.

The self-run facilitator verifies signatures through the Mirror Node, checks
balance/association readiness, and submits a native TransferTransaction. A
durable fingerprinted journal and exclusive service lock prevent resubmission
after uncertain outcomes. State uses fsynced files and atomic rename; no
distributed or universal power-loss guarantee is claimed. Do not delete the
private `.merchant-state/native-exact/` directory as a retry strategy. Inspect
the saved transaction on the Mirror Node and reconcile before clearing a stale
service lock after a crash. Native consensus history is the settlement authority.

## Run

1. Create two dedicated **testnet ECDSA** accounts at https://portal.hedera.com/:
   payer and facilitator. Fund them with test HBAR. The facilitator can also be
   the merchant; use a distinct public recipient if preferred.
2. Copy `backend/.env.hedera.example` to `backend/.env.hedera` and fill the five
   X402 account/private-key fields. Keep this ignored file private. Raw ECDSA
   keys require a `0x` prefix; SDK DER private keys are also accepted.
3. After root setup, install Chromium with `npx playwright install chromium`
   from `contracts/`, or set `JANUS_CHROMIUM_PATH` to an installed executable.
4. `npm run x402:test --prefix backend` verifies the real SDK transaction shapes,
   signature binding, quote limits, allowlist, durable replay and unknown-outcome
   refusal offline. Network consensus and balances are fixtures in this test.
5. `npm run x402:live --prefix backend` explicitly spends 0.0001 test HBAR,
   records a native paid request and replay, independently checks the public
   Mirror result, and saves a captioned WebM plus public JSON evidence. The
   command refuses unsupported networks/amounts. A completed-run guard spends
   nothing on subsequent runs. USDC mode is explicitly `asset=0.0.429274` and
   `amount=20000`; the payer must hold associated test USDC.

## Limits

This native endpoint is **separate from TaskTreasury**. Its request cap and payer
allowlist are not onchain task budgets. The older executor HTTP path and newer
task-aware quote/purchase SDK have their own recorded financial proofs but do
not match the current native exact transaction payload. Do not substitute their
historical transaction IDs for new native exact evidence. HCS identity/logging,
A2A/ACP, Scheduled Transactions and Agent Kit/MCP are optional bonuses and are
not implemented by installing this SDK. This is not a production facilitator.
