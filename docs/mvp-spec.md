# Agent Control Plane MVP Spec

## Purpose
Define the first buildable version of `Agent Control Plane`.

This MVP is a minimum control plane for one high-risk action type. The focus is not agent execution itself, but a single flow that combines `policy checks`, `approval gates`, `audit records`, and minimal `handoff`.

## One-line Definition
An operational layer that accepts a structured high-risk action request, evaluates policy, requires approval when needed, and records the full outcome as append-only audit events.

## Goals
- eliminate any execution path that bypasses approval or policy
- make every request reconstructable end-to-end from a single `task_id`
- support `allow`, `deny`, `approval_required`, and `handoff_required`
- make the MVP demonstrable locally through a CLI

## Non-goals
- agent runtime or orchestration engine
- multi-step workflows
- model hosting
- full web UI
- broad SaaS connector coverage
- compliance automation guarantees

## Target Users
- platform, security, and IT teams introducing internal AI agents
- operators who must approve, reject, or audit write actions performed by agents

## MVP Product Cut
### Core
- `policy`
- `approval`
- `audit`
- minimal `handoff`

### Single Action Scope
The MVP supports one action type only:
- `record_update`

Meaning:
- an agent submits a structured request to modify part of a resource

Initial demo shape:
- treat a local JSON or Markdown file as the resource
- update it only after policy evaluation and approval flow are complete

Why this scope:
- it mirrors real write-back patterns seen in internal agent deployments
- it validates the control flow without depending on external connectors
- it can later expand into adapters such as `docs_write` or `sheet_row_update`

## Primary Flow
1. An agent submits an `ActionRequest`.
2. The system evaluates policy.
3. If the decision is `deny`, the request ends.
4. If the decision is `approval_required`, the request pauses for a human decision.
5. If approved, the request moves to execution.
6. Execution success or failure is recorded.
7. Missing context or recoverable exceptions can move the request to `handoff_required`.
8. Every state change is recorded as an append-only audit event.

## State Machine
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

Allowed transitions:
- `received -> policy_evaluating`
- `policy_evaluating -> rejected`
- `policy_evaluating -> approved`
- `policy_evaluating -> approval_required`
- `policy_evaluating -> handoff_required`
- `approved -> executing`
- `approved -> handoff_required`
- `approved -> expired`
- `executing -> succeeded`
- `executing -> failed`
- `approval_required -> approved`
- `approval_required -> rejected`
- `approval_required -> expired`
- `approval_required -> handoff_required`
- `failed -> handoff_required`
- `handoff_required -> handoff_completed`

Disallowed rules:
- `approval_required` and `handoff_required` are distinct states
- execution must never start before `approved`
- `expired` and `rejected` requests cannot be re-executed

## Core Entities
### ActionRequest
Required fields:
- `task_id`
- `action_id`
- `actor_id`
- `tool`
- `operation`
- `resource_type`
- `resource_id`
- `risk_level`
- `expected_effect`
- `payload`
- `policy_context`
- `idempotency_key`
- `submitted_at`

### PolicyDecision
Required fields:
- `task_id`
- `policy_id`
- `policy_version`
- `decision`
- `reason_code`
- `evaluated_at`

Decision values:
- `allow`
- `deny`
- `approval_required`
- `handoff_required`

### ApprovalDecision
Required fields:
- `task_id`
- `action_schema_hash`
- `policy_id`
- `policy_version`
- `approver_id`
- `decision`
- `decision_reason_code`
- `timestamp`
- `expires_at`
- `prior_decision_id`

### ExecutionResult
Required fields:
- `task_id`
- `execution_id`
- `status`
- `result_summary`
- `executor_id`
- `started_at`
- `finished_at`

### AuditEvent
Required fields:
- `event_id`
- `task_id`
- `event_type`
- `state`
- `actor_type`
- `actor_id`
- `timestamp`
- `payload_hash`
- `prev_event_hash`
- `event_hash`

### HandoffTicket
Required fields:
- `task_id`
- `handoff_reason`
- `required_context`
- `assigned_to`
- `status`
- `created_at`

## Approval Token Binding
Approval artifacts must be strongly bound to:
- `task_id`
- `action_schema_hash`
- `resource_scope`
- `policy_version`
- `expires_at`

Default validation behavior is `fail-closed`.

## API Surface
### Public API
`POST /v1/action-requests`
- submit a structured action request

`GET /v1/action-requests/:task_id`
- inspect current state and latest decisions

`POST /v1/action-requests/:task_id/approve`
- approve with approver identity and approval token

`POST /v1/action-requests/:task_id/reject`
- reject and record a reason

`POST /v1/action-requests/:task_id/handoff`
- create a human handoff ticket

`GET /v1/audit-events?task_id=:task_id`
- fetch the audit trail for a task

### Internal API
`POST /v1/action-requests/:task_id/execute`
- dispatch an approved request to the executor

`POST /v1/action-requests/:task_id/execution-result`
- record execution outcome

## CLI Surface
Recommended commands:

```bash
acp submit action-request.json
acp inspect TASK_ID
acp approve TASK_ID --approver alice
acp execute TASK_ID
acp reject TASK_ID --approver alice --reason policy_violation
acp handoff TASK_ID --to ops-queue --reason missing_context
acp audit TASK_ID
```

## First Implementation Slice
Start in `packages/core` with:
- domain types
- state machine
- audit event model

After that:
1. implement SQLite persistence in `packages/sqlite`
2. implement read-path CLI commands in `packages/cli`
3. implement write-path CLI commands
4. add the local `record_update` example executor
