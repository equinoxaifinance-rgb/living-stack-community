# Living Stack Community

Buyer guides: [run a real proof loop](https://github.com/equinoxaifinance-rgb/living-stack-community/blob/main/guides/first-proof.md) · [choose the right edition](https://github.com/equinoxaifinance-rgb/living-stack-community/blob/main/guides/choose-edition.md).

Living Stack Community is the free **seven-tool proof loop** for MCP-capable agents. It proves the core behavior before a buyer pays: open a scoped session, authorize a bounded action, record typed evidence, check a claim against the exact subject and outcome, and close the session with a tamper-evident local ledger.

It does **not** include the paid implementation for durable memory, recovery checkpoints, portable signed traces, release-byte verification, adoption receipts, or multi-agent coordination.

## Install

```bash
npx -y github:equinoxaifinance-rgb/living-stack-community
```

Requires Node.js 22 or newer. The MCP command is `node /path/to/living-stack-community/server.mjs`.

Want to help validate the product without buying it? Join the [five-user proof pilot](PILOT.md). Feedback is opt-in through a public GitHub issue; the Community runtime itself still makes no network calls.

## Included tools

- `livingstack.status`
- `livingstack.session_start`
- `livingstack.session_status`
- `livingstack.authorize_action`
- `livingstack.record_outcome`
- `livingstack.check_claim`
- `livingstack.session_close`

## Upgrade to Complete Local

[Complete Local](https://living-stack-mcp.pages.dev/#pricing) has 23 tools and adds the capabilities that turn the proof loop into an operating runtime: durable context memory, checkpoint recovery, Ed25519-signed portable traces, release verification, opt-in adoption receipts, and all multi-agent Team workflows.

Community is not a time-limited trial. It is the permanent proof edition. Complete Local is the product for ongoing work.

## Privacy and boundaries

- State is local by default.
- Raw goals, scopes, targets, evidence references, summaries, and close reasons are stored only as SHA-256 digests.
- The default policy rejects external and destructive actions.
- The server gates and records host actions; it never executes them.
- Community has no telemetry or network calls.

See [PRODUCT.md](PRODUCT.md) and [SECURITY.md](SECURITY.md).
