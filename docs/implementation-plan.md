# Agent Control Plane Implementation Plan

## Scope
This plan fixes the delivery order for the MVP implementation.

Included:
- single action type `record_update`
- single state machine
- single SQLite-backed store
- single CLI entrypoint
- append-only audit stream
- minimal handoff support

Excluded:
- multi-step workflows
- external SaaS connectors
- web UI
- generalized execution engines

## Dependency Documents
The following docs are the baseline contracts for implementation:
- [MVP Spec](./mvp-spec.md)
- [Event Schema](./event-schema.md)
- [SQLite Schema](./sqlite-schema.md)
- [CLI Contract](./cli-contract.md)

## Delivery Order
### 1. Core Domain Types
Lock the following types first:
- `ActionRequest`
- `PolicyDecision`
- `ApprovalDecision`
- `ExecutionResult`
- `AuditEvent`
- `HandoffTicket`

Goal:
- align code terminology with the documents before persistence or CLI logic grows around it

### 2. State Machine
Implement and centralize:
- `received -> policy_evaluating -> approval_required/approved/rejected -> executing -> succeeded/failed -> handoff_required -> handoff_completed`

Goal:
- block invalid transitions in one place instead of inside individual handlers

### 3. SQLite Storage
Implement tables in this order:
1. `action_requests`
2. `audit_events`
3. `approval_decisions`
4. `policy_decisions`
5. `execution_results`
6. `handoff_tickets`

Goal:
- get `submit -> inspect -> audit` working first

### 4. Policy Evaluator
Start with a deterministic ruleset:
- unsupported `resource_type` -> `deny`
- unknown field -> `handoff_required`
- `risk_level=high` -> `approval_required`
- `risk_level=low` and local scope -> `allow`

Goal:
- prove fail-closed behavior without adding natural-language policy parsing

### 5. CLI Read Path
Implement read commands first:
- `acp inspect`
- `acp audit`

Goal:
- make state and audit visibility available early

### 6. CLI Write Path
Then implement write commands:
- `acp submit`
- `acp approve`
- `acp reject`
- `acp handoff`

Goal:
- validate the human approval loop and state transitions

### 7. Local Executor
Add a `record_update` executor for local JSON or Markdown files.

Goal:
- complete an end-to-end write-back demo

### 8. Hardening Pass
Verify:
- audit hash chain
- approval token binding
- post-approval mutation detection
- fail-closed behavior when audit writes fail

## Validation Checkpoints
### Checkpoint 1
`submit -> policy -> audit` works.

Pass criteria:
- request is retrievable by `task_id`
- audit events are appended in order

### Checkpoint 2
`approval_required -> approve/reject` works.

Pass criteria:
- re-approval is blocked
- invalid state transitions are blocked

### Checkpoint 3
`approved -> execute -> success/failure` works.

Pass criteria:
- local resource updates are applied
- result events are recorded

### Checkpoint 4
`failure -> handoff_required -> handoff_completed` works.

Pass criteria:
- handoff ticket is created
- the audit trail reconstructs the full path

## Risks
- duplicating state transition logic across CLI handlers will break consistency
- unclear `payload` and `action_schema_hash` rules will weaken approval invalidation
- ignoring audit write failures destroys the core value of the product
- generalizing the executor too early will expand scope and slow the MVP

## Immediate Next Step
Implement `domain types + state machine + audit event model` in `packages/core`, then move to SQLite persistence in `packages/sqlite`.
