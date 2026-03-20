# Architecture

## Goal
This project wraps high-risk agent actions with:
- policy
- approval
- execution control
- append-only audit
- minimal human handoff

## Packages
- `packages/core`
  - domain types
  - state machine
  - policy rules
  - audit hashing and verification
- `packages/sqlite`
  - SQLite persistence
  - transaction boundaries
  - append-only audit storage
- `packages/cli`
  - operator commands
  - input validation
  - exit code handling
  - local demo executor

## Main Flow
1. `submit`
2. policy decision
3. `approve` or `reject` or `handoff`
4. `execute`
5. `verify-audit` and `audit`

## Invariants
- execution never starts before approval
- unknown fields are not silently accepted
- post-approval mutation invalidates execution
- audit integrity failure is fail-closed
- state transitions are centralized in `packages/core`

## Storage
The current MVP uses SQLite through `node:sqlite`.
This is sufficient for local validation, but the runtime still emits an experimental warning on current Node releases.
