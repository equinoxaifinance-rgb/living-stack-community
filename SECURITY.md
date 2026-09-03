# Security

Report vulnerabilities privately through the repository security advisory flow. Do not include credentials, private workspace content, or exploit payloads in public issues.

Community uses a local state directory (`LIVING_STACK_STATE_DIR` or `~/.living-stack-community`), atomic writes, restrictive file modes where supported, SHA-256 subject binding, one-use authorization receipts, cost reservations, and a hash-linked event ledger. External and destructive risks fail closed under the Community policy.

The ledger demonstrates local integrity for its stored events. It is not a publisher signature, remote attestation, or proof that a host actually performed an action; typed evidence still has to identify the downstream receipt.

Claim checks require verification evidence and reject the entire selected set
if any outcome is unknown, unsuccessful, stale, or bound to another subject.
Exact subjects are hashed before display redaction; different release digests
must never collapse into one identity. Mutable budget, outcome, authorization,
and lifecycle state is reconciled against the event ledger on every read.

Legacy sessions without binding version 2 remain readable but cannot be
mutated or used to approve new claims: start a fresh scoped session after an
upgrade. Redacted legacy identities cannot be recovered safely. No old state
is silently rewritten. A local administrator able to rewrite both state and
the full hash chain remains outside this local integrity guarantee.

Each session mutation holds an exclusive lock across read, verification and
write. A competing writer receives `session_busy_retry`; retry that action
after the active call finishes. Locks are released on ordinary errors. If a
writer is forcibly terminated, its lock may remain: stop all writers using
that state directory, back up the session, then remove only that session's
`.json.lock` file before restarting. Locks are never stolen on a timeout.
Use a local filesystem that supports exclusive creation and atomic rename;
network filesystems and hostile administrators are outside this boundary.

`retention_hours` records the requested retention policy but does not schedule
automatic deletion. Operators must remove expired local state themselves;
do not treat this beta's retention field as an automatic privacy control.
