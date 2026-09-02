# Security

Report vulnerabilities privately through the repository security advisory flow. Do not include credentials, private workspace content, or exploit payloads in public issues.

Community uses a local state directory (`LIVING_STACK_STATE_DIR` or `~/.living-stack-community`), atomic writes, restrictive file modes where supported, SHA-256 subject binding, one-use authorization receipts, cost reservations, and a hash-linked event ledger. External and destructive risks fail closed under the Community policy.

The ledger demonstrates local integrity for its stored events. It is not a publisher signature, remote attestation, or proof that a host actually performed an action; typed evidence still has to identify the downstream receipt.
