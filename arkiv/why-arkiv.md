# Why Arkiv

Reproduce the public-directory property with `npm run arkiv:query`: it reads
Rabdi directly with the SDK and requires no Janus API, user account or writer
private key. The [schema](schema.md) identifies the exact indexed fields.
The [handoff evidence](../backend/arkiv/evidence/2026-11-07/local-demo-report.json)
records the selected entity and reuse of the original payment.

Wallet-owned expiring profiles can be queried independently of Janus's backend. A proprietary private directory would prevent another client from discovering the same records without Janus access. Profile ownership and expiry match short-lived worker availability. Private prompts, credentials and durable financial journals stay off the public directory. Arkiv is not treated as the financial ledger or as proof that a worker is trustworthy.
