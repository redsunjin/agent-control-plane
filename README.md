# Agent Control Plane

Open-source library for `policy`, `approval`, `audit`, and minimal `handoff` around high-risk AI agent actions.

## Scope
This repository starts from a narrow MVP:
- single action type: `record_update`
- single state machine
- append-only audit events
- SQLite-backed persistence
- CLI for operator workflows

## Packages
- `packages/core`
  - domain types, state machine, audit event model
- `packages/sqlite`
  - SQLite storage adapter
- `packages/cli`
  - CLI for submit, inspect, approve, reject, handoff, complete-handoff, execute, verify-audit, and audit
- `examples/local-record-update`
  - local example flow for the MVP

## Documentation
Canonical project docs now live in [`docs/`](./docs):
- [`docs/README.md`](./docs/README.md)
- [`docs/mvp-spec.md`](./docs/mvp-spec.md)
- [`docs/event-schema.md`](./docs/event-schema.md)
- [`docs/sqlite-schema.md`](./docs/sqlite-schema.md)
- [`docs/cli-contract.md`](./docs/cli-contract.md)
- [`docs/implementation-plan.md`](./docs/implementation-plan.md)
- [`docs/test-plan.md`](./docs/test-plan.md)

These documents were adapted from the ideation workspace and are now the local source of truth for implementation in this repository.

## Current Status
The MVP path is implemented locally:
- `submit -> inspect -> approve -> execute -> verify-audit -> audit`
- policy denial flow
- unknown-field handoff flow
- handoff completion
- approval expiry and post-approval mutation fail-closed behavior

## Quick Start
```bash
npm install
npm run build

DB_FILE="$(pwd)/examples/local-record-update/demo.sqlite"

node packages/cli/dist/index.js submit examples/local-record-update/requests/approved-markdown.json --db "$DB_FILE"
node packages/cli/dist/index.js inspect demo-markdown-approval --db "$DB_FILE"
node packages/cli/dist/index.js approve demo-markdown-approval --approver alice --db "$DB_FILE"
node packages/cli/dist/index.js execute demo-markdown-approval --db "$DB_FILE"
node packages/cli/dist/index.js verify-audit demo-markdown-approval --db "$DB_FILE"
node packages/cli/dist/index.js audit demo-markdown-approval --db "$DB_FILE"
```

Additional example requests:
- `examples/local-record-update/requests/deny-remote.yaml`
- `examples/local-record-update/requests/handoff-unknown-field.json`

## Validation
```bash
npm run check
npm test
```

## Runtime Note
The current SQLite adapter uses Node's `node:sqlite` module, which still emits an experimental warning on current Node releases.
