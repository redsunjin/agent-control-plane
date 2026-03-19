# Agent Control Plane Event Schema

## Purpose
Make every state transition reconstructable by `task_id` in the MVP.

This schema is scoped to the single `record_update` action. The main goal is to retain an append-only trail for `request -> policy -> approval/rejection -> execution -> result -> handoff`.

## Core Event Types
### 1. `action.requested`
Emitted when an agent submits a structured action request.

Primary payload:
- `action_id`
- `tool`
- `operation`
- `resource_type`
- `resource_id`
- `risk_level`
- `expected_effect`
- `policy_context`
- `idempotency_key`
- `request_payload_hash`

State transition:
- `received`

### 2. `policy.evaluated`
Emitted when the policy engine evaluates a request.

Primary payload:
- `policy_id`
- `policy_version`
- `decision`
- `reason_code`
- `matched_rules`

Decision values:
- `allow`
- `deny`
- `approval_required`
- `handoff_required`

Resulting states:
- `deny -> rejected`
- `allow -> approved`
- `approval_required -> approval_required`
- `handoff_required -> handoff_required`

### 3. `approval.requested`
Emitted when human approval is required.

Primary payload:
- `policy_id`
- `policy_version`
- `action_schema_hash`
- `resource_scope`
- `approval_expires_at`
- `approval_summary`

State transition:
- `policy_evaluating -> approval_required`

### 4. `approval.decided`
Emitted when a human approves or rejects the request.

Primary payload:
- `approver_id`
- `decision`
- `decision_reason_code`
- `prior_decision_id`
- `approval_token_hash`
- `expires_at`

Decision values:
- `approved`
- `rejected`

State transitions:
- `approval_required -> approved`
- `approval_required -> rejected`
- `approval_required -> expired`

### 5. `execution.started`
Emitted when an approved request begins execution.

Primary payload:
- `executor_id`
- `execution_target`
- `approved_action_hash`
- `execution_context_hash`

State transition:
- `approved -> executing`

### 6. `execution.completed`
Emitted when execution completes.

Primary payload:
- `execution_id`
- `status`
- `result_summary`
- `result_hash`

State transitions:
- `executing -> succeeded`
- `executing -> failed`

### 7. `handoff.requested`
Emitted when a human handoff is needed because of missing context, failure, or an exceptional condition.

Primary payload:
- `handoff_reason`
- `required_context`
- `assigned_to`
- `ticket_priority`

State transitions:
- `failed -> handoff_required`
- `approval_required -> handoff_required`
- `policy_evaluating -> handoff_required`
- `approved -> handoff_required`

### 8. `handoff.completed`
Emitted when a human handoff is completed.

Primary payload:
- `assigned_to`
- `resolution_summary`
- `resolution_hash`

State transition:
- `handoff_required -> handoff_completed`

### 9. `audit.appended`
Represents the audit-integrity layer for each event.

Primary payload:
- `event_hash`
- `prev_event_hash`
- `payload_hash`
- `chain_index`

This can be modeled as either a dedicated event or metadata carried by every persisted event. The MVP can choose the simpler implementation so long as integrity rules remain explicit.

## Shared Fields
Every event carries:
- `event_id`
- `task_id`
- `event_type`
- `state`
- `actor_type`
- `actor_id`
- `occurred_at`
- `schema_version`
- `payload_hash`
- `prev_event_hash`
- `event_hash`

Recommended optional fields:
- `correlation_id`
- `idempotency_key`
- `source`

## State Transitions
Fixed states:
- `received`
- `policy_evaluating`
- `approval_required`
- `approved`
- `rejected`
- `executing`
- `succeeded`
- `failed`
- `handoff_required`
- `handoff_completed`
- `expired`

Recommended flow:
1. `action.requested` -> `received`
2. `policy.evaluated` -> `policy_evaluating`
3. `policy.decision=deny` -> `rejected`
4. `policy.decision=allow` -> `approved`
5. `policy.decision=approval_required` -> `approval_required`
6. `policy.decision=handoff_required` -> `handoff_required`
7. `approval.decided=approved` -> `approved`
8. `execution.started` -> `executing`
9. `execution.completed=success` -> `succeeded`
10. `execution.completed=failure` -> `failed`
11. `handoff.requested` -> `handoff_required`
12. `handoff.completed` -> `handoff_completed`

Principles:
- policy `allow` promotes the request directly into an executable `approved` state
- `approval_required` is a waiting state, not an executable state
- `rejected` and `expired` requests can never transition into `executing`

## Validation Rules
- one `task_id` represents one action request flow
- `event_id` is never reused
- events are append-only
- `event_hash` is calculated using the current event together with `prev_event_hash`
- `approval.decided` must be bound to `task_id` and `action_schema_hash`
- any mutation after approval must force rejection or handoff
- unknown `event_type` values are rejected
- action types other than `record_update` are rejected in the MVP
- `execution.started` is valid only after `approved`
- `handoff.completed` requires an earlier `handoff.requested`

## Open Questions
- should `policy.evaluated` and the resulting policy decision remain a single event
- should `audit.appended` be a dedicated event or only shared metadata
- should code distinguish policy-driven approval from human approval using separate markers in the approved state
- should `event_hash` be computed from normalized payloads only
- should handoff be available only after failures, or also directly from policy and approval paths
- should `execution.completed` include diff and rollback metadata in the MVP

## Next Step
Use this schema as the baseline for [SQLite Schema](./sqlite-schema.md) and [CLI Contract](./cli-contract.md).
