# Agent Control Plane Docs

This directory contains the local planning and contract documents for the repository.

## Read Order
1. [MVP Spec](./mvp-spec.md)
2. [Event Schema](./event-schema.md)
3. [SQLite Schema](./sqlite-schema.md)
4. [CLI Contract](./cli-contract.md)
5. [Implementation Plan](./implementation-plan.md)
6. [Test Plan](./test-plan.md)

## Repository Map
- `packages/core`
  - domain types, state machine, audit event model
- `packages/sqlite`
  - SQLite persistence and repository adapters
- `packages/cli`
  - operator-facing CLI commands
- `examples/local-record-update`
  - local-first MVP demo scenario

## Current Product Cut
- single action type: `record_update`
- single state machine
- append-only audit stream
- SQLite persistence
- CLI-driven operator flow
- minimal human handoff

## Source Notes
These docs were adapted from the ideation documents in `/Users/Agent/ps-workspace/dunkin/ideas/projects/agent-control-plane/`.
The copies in this repository should be treated as the implementation baseline going forward.
