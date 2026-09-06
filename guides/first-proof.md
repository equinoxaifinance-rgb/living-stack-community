# Record a real local action, then check its claim

Living Stack Community is a seven-tool local proof loop. It does not execute your task for you. The host performs the action, observes what happened and supplies evidence; the product binds that report to an authorization and a scoped session.

Start with the [installation instructions](../README.md). Confirm that your host exposes exactly seven Community tools. Then use a harmless file that you are allowed to read:

1. `livingstack.session_start`: scope `read one documentation file`, goal `measure its SHA-256`, budget zero.
2. `livingstack.authorize_action`: use the returned session ID, a new action ID, `action_type: verification.read`, `risk: read`, cost zero and the exact file as target.
3. Only after authorization, have the host read the file and compute SHA-256. Record the actual result separately. Do not supply a prewritten hash as though the host computed it.
4. `livingstack.record_outcome`: bind the returned authorization ID to `success` only if the read/hash actually succeeded. Include evidence type `verification` and a reference to that observation.
5. `livingstack.check_claim`: pass the same target as subject, the new outcome ID and required evidence type `verification`.
6. Change the claim's subject to another file. That unsupported claim must fail; a hash of one file is not evidence about a different file.
7. Close the session with `livingstack.session_close` and retain the host-side evidence privately.

The product retains SHA-256 digests of raw values in its local ledger. Keep the original evidence yourself. A tamper-evident chain is not an independent witness: a dishonest caller can still submit a dishonest observation. Enforcement also depends on the host routing actions through the tool; Community cannot intercept everything another program does.

If your next task needs durable context retrieval, recovery checkpoints, signed trace export, release verification or multi-agent handoff, compare [Complete Local](https://living-stack-mcp.pages.dev/#pricing). Those are paid capabilities, not hidden Community flags. For setup feedback, use the bounded [pilot](../PILOT.md); do not upload private ledgers or task content.
