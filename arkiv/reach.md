# Reach

The team confirms it will continue building Janus after Mumbai. Public demo:
[janus-puce.vercel.app](https://janus-puce.vercel.app). The hosted frontend is a
try-it entry point; persisted child-process research requires a long-lived Node
host, so a Vercel URL alone is not evidence of the complete research runtime.

## Try it today

For research-task owners and worker operators: clone the public repository,
run `npm run setup`, then `npm run arkiv:query` for an independent live read.
Run `npm run contracts:compile` and `npm run demo:handoff` to try recovery and
discovery selection locally without a funded key. For the browser directory,
run `npm run dev`, configure login as described in the root README, and open
Dashboard → Integrations → Read worker directory. Empty results after profile
expiry are expected; they must not silently become hardcoded workers.

Measured scope: one writer, two recorded publications, one browser-read proof,
and one live-discovery/local-finance handoff. These are integration measurements,
not external users. See [receipts and query evidence](../backend/arkiv/evidence/2026-11-07/README.md).

No verified external users or downstream projects are claimed. Intended users are research-task owners and independent worker operators who need replacement discovery across clients. Try the independent query, local handoff and funded-key live-discovery demo in `shared/ARKIV.md`. Browser publication/configuration is available; browser orchestration remains separate.

Record actual distinct operators, successful publications, discovery-to-assignment runs and user feedback before claiming adoption. Local logical workers are not external users. Continuation/deployment commitments require the team's actual decision and are not invented here.

## Funded verification, 7 November 2026

Writer `0xf4F1a10309FCb1514bF6b0eb1E4813E220D936F0` published two one-hour Rabdi entities (one per execution-network filter) with confirmed receipts. Independent CLI reads and an actual React directory read found the Hedera-compatible profile. Live Arkiv selection drove the local financial handoff: epoch 2, five distinct purchases totaling 100 local units, original payment reused, stale worker rejected and unrelated tasks preserved. See [raw evidence and scope](../backend/arkiv/evidence/2026-11-07/README.md). There is one writer and no measured external adoption. Profiles and availability leases expire; this is historical proof, not a promise of an always-populated directory. Early browser-test attempts required correcting the fixture heading and replacing the public environment variable as Next does; those were test-harness issues, not an Arkiv node failure. No new Hedera transaction or complete remote research orchestration is claimed.
