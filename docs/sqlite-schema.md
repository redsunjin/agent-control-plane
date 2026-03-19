# Agent Control Plane SQLite Schema

## Purpose
Define the SQLite schema for tracking the single-action MVP reliably.

The goal is to reconstruct requests, policy decisions, approvals, execution outcomes, handoffs, and audit history end-to-end from a single `task_id`.

## Tables
### `action_requests`
Stores the original structured request submitted by the agent.

Required columns:
- `task_id` `TEXT PRIMARY KEY`
- `action_id` `TEXT NOT NULL`
- `actor_id` `TEXT NOT NULL`
- `tool` `TEXT NOT NULL`
- `operation` `TEXT NOT NULL`
- `resource_type` `TEXT NOT NULL`
- `resource_id` `TEXT NOT NULL`
- `risk_level` `TEXT NOT NULL`
- `expected_effect` `TEXT NOT NULL`
- `payload` `TEXT NOT NULL`
- `policy_context` `TEXT NOT NULL`
- `idempotency_key` `TEXT NOT NULL`
- `state` `TEXT NOT NULL`
- `created_at` `TEXT NOT NULL`
- `updated_at` `TEXT NOT NULL`

### `policy_decisions`
Stores the policy evaluation for a request.

Required columns:
- `policy_decision_id` `TEXT PRIMARY KEY`
- `task_id` `TEXT NOT NULL`
- `policy_id` `TEXT NOT NULL`
- `policy_version` `TEXT NOT NULL`
- `decision` `TEXT NOT NULL`
- `reason_code` `TEXT NOT NULL`
- `evaluated_at` `TEXT NOT NULL`

### `approval_decisions`
Stores human approvals and rejections.

Required columns:
- `approval_decision_id` `TEXT PRIMARY KEY`
- `task_id` `TEXT NOT NULL`
- `action_schema_hash` `TEXT NOT NULL`
- `policy_id` `TEXT NOT NULL`
- `policy_version` `TEXT NOT NULL`
- `approver_id` `TEXT NOT NULL`
- `decision` `TEXT NOT NULL`
- `decision_reason_code` `TEXT NOT NULL`
- `prior_decision_id` `TEXT`
- `expires_at` `TEXT NOT NULL`
- `created_at` `TEXT NOT NULL`

### `execution_results`
Stores execution outcomes after approval.

Required columns:
- `execution_result_id` `TEXT PRIMARY KEY`
- `task_id` `TEXT NOT NULL`
- `execution_id` `TEXT NOT NULL`
- `status` `TEXT NOT NULL`
- `result_summary` `TEXT NOT NULL`
- `executor_id` `TEXT NOT NULL`
- `started_at` `TEXT NOT NULL`
- `finished_at` `TEXT NOT NULL`

### `handoff_tickets`
Stores human handoff information for failures and missing context.

Required columns:
- `handoff_ticket_id` `TEXT PRIMARY KEY`
- `task_id` `TEXT NOT NULL`
- `handoff_reason` `TEXT NOT NULL`
- `required_context` `TEXT NOT NULL`
- `assigned_to` `TEXT`
- `status` `TEXT NOT NULL`
- `created_at` `TEXT NOT NULL`
- `closed_at` `TEXT`

### `audit_events`
Stores the append-only audit event stream.

Required columns:
- `event_id` `TEXT PRIMARY KEY`
- `task_id` `TEXT NOT NULL`
- `event_type` `TEXT NOT NULL`
- `state` `TEXT NOT NULL`
- `actor_type` `TEXT NOT NULL`
- `actor_id` `TEXT NOT NULL`
- `timestamp` `TEXT NOT NULL`
- `payload` `TEXT NOT NULL`
- `schema_version` `TEXT NOT NULL`
- `payload_hash` `TEXT NOT NULL`
- `prev_event_hash` `TEXT`
- `event_hash` `TEXT NOT NULL`

Recommended optional columns:
- `correlation_id` `TEXT`
- `idempotency_key` `TEXT`
- `source` `TEXT`

## Constraints
### Shared Constraints
- all timestamps are stored as ISO-8601 `TEXT`
- `task_id` is the primary tracking key across core tables
- `approval_required` and `handoff_required` remain distinct values in `action_requests.state`
- `audit_events` are never updated or deleted
- `decision`, `status`, `state`, and `risk_level` should use closed value sets rather than free text
- `audit_events.payload` should store canonical JSON text for later inspection and hash verification

### Recommended CHECK Constraints
```sql
CHECK (decision IN ('allow', 'deny', 'approval_required', 'handoff_required'))
CHECK (state IN ('received', 'policy_evaluating', 'approval_required', 'approved', 'rejected', 'executing', 'succeeded', 'failed', 'handoff_required', 'handoff_completed', 'expired'))
CHECK (risk_level IN ('low', 'medium', 'high'))
```

### Recommended Foreign Keys
- `policy_decisions.task_id` -> `action_requests.task_id`
- `approval_decisions.task_id` -> `action_requests.task_id`
- `execution_results.task_id` -> `action_requests.task_id`
- `handoff_tickets.task_id` -> `action_requests.task_id`
- `audit_events.task_id` -> `action_requests.task_id`

Assume `PRAGMA foreign_keys = ON;`.

### Uniqueness
- `action_requests.idempotency_key` should be unique
- latest policy, approval, and execution entries for a task should be queryable efficiently, even if history is kept

## Indexes
Recommended indexes:
- `idx_action_requests_state_created_at` on `(state, created_at)`
- `idx_action_requests_resource` on `(resource_type, resource_id)`
- `idx_policy_decisions_task_id_evaluated_at` on `(task_id, evaluated_at)`
- `idx_approval_decisions_task_id_created_at` on `(task_id, created_at)`
- `idx_execution_results_task_id_finished_at` on `(task_id, finished_at)`
- `idx_handoff_tickets_status_created_at` on `(status, created_at)`
- `idx_audit_events_task_id_timestamp` on `(task_id, timestamp)`
- `idx_audit_events_event_hash` on `(event_hash)`

Why:
- most CLI queries are centered on `task_id`
- operators will need state-based queues and recent-item lookups
- audit verification needs both task and hash access paths

## Migration Notes
- start with a single initial migration if needed
- do not over-generalize action typing before the MVP proves out
- store `payload` as JSON text initially and normalize later only if necessary
- keep `action_requests.state` aligned exactly with the state machine in code
- preserve insert-only ordering in `audit_events`
- `prev_event_hash` can be nullable but should be used when present for integrity checks

## Initial Build Order
Implement these three pieces first:
1. `action_requests`
2. `audit_events`
3. `approval_decisions`

That is enough to validate `submit -> policy -> approve/reject -> execute -> audit`.
