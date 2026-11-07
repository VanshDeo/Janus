# Local Docker Compose

Install Docker Engine/Desktop with Compose and start its Linux engine, then from the repository root:

```sh
docker compose up --build --wait
```

Open http://localhost:3000. The task-aware merchant is at http://localhost:4023 and local EVM JSON-RPC at http://localhost:8545. Health checks gate contract deployment, backend startup and frontend readiness. No host Node installation, Hedera credentials, database server or manual contract deployment is required. The current application uses durable filesystem storage, not Postgres.

The contracts image compiles both phases. Its service runs persistent Ganache (chain 1337), deploys a local test token and Phase-1 treasury, deposits 1,000,000 base units and creates `compose-demo` with a 100,000-unit budget and 20,000-unit purchase ceiling. `GET /deployment` on the backend returns its public manifest. Restart reuses and validates the existing deployment. An interrupted bootstrap fails closed rather than silently deploying again.

Verify a real SDK purchase and replay (spends 20,000 local test-token units once):

```sh
docker compose exec backend node backend/docker/smoke.mjs
docker compose ps
docker compose logs backend contracts
docker compose down
```

`down` preserves the chain, merchant and workbench volumes. Keep these volumes together: merchant records contain original paid results and the workbench links them to runs. For a deliberate disposable local reset only, `docker compose down --volumes` deletes all three. Abruptly killed signers can leave fail-closed locks; reconcile before removing locks rather than treating state as cache.

Optional Privy login: copy `.env.compose.example` to `.env`, set your application IDs and server verification public key, and rebuild. Add localhost to the Privy application's allowed origins. Public IDs are build arguments embedded by Next.js; verification keys are supplied only at runtime. Existing module environment files and credentials are excluded from Docker builds. Empty IDs keep sign-in disabled. Port overrides are in the template.

## Paid research and recovery

With Privy configured, open **Runs**, choose **Local paid research** and start a run. Each worker buys one TaskTreasury reference from a 20,000-unit local task budget. Run cards read available, reserved and spent units from the same deployment used by the merchant. The treasury panel uses the published loopback RPC and that deployment.

To test recovery with live Arkiv records, configure a dedicated Rabdi test wallet in the Compose environment and in the Arkiv CLI environment. Publish a fresh profile before running the test:

```sh
ARKIV_WORKER_NETWORK=eip155:1337 npm run arkiv:publish
```

Publishing uses Rabdi test gas. With **Wait at the first paid checkpoint** checked, click **Interrupt worker** after the source settles. Look for the live Arkiv selection, confirmed new worker and epoch, and **Paid result reused—no additional charge** with the original receipt. If the record expires or discovery is unavailable, the branch waits. Restore the record and click **Resume**.

Treasury and merchant transactions use local test tokens. The development mnemonic is public and ports bind to host loopback.
