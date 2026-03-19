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
  - CLI for submit, inspect, approve, reject, handoff, audit
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

## Recommended First Coding Step
Implement these first in `packages/core`:
- domain types
- state machine
- audit event model

After that:
1. add SQLite persistence in `packages/sqlite`
2. add read-path CLI in `packages/cli`
3. add write-path CLI
4. add local `record_update` executor example
