# Agent Control Plane CLI Contract

## Purpose
Define the CLI contract for validating the MVP locally from end to end.

This contract is intentionally limited to the single action scope `record_update`. The priority is proving `policy -> approval -> execution -> audit` rather than integrating external services.

## Principles
- the CLI is for human operators
- the underlying library and services can expose the same logic through APIs later
- every command must remain traceable by `task_id`
- unknown fields, invalid state transitions, and reused approval artifacts are rejected
- default failure behavior is `fail-closed`

## Commands
### `acp submit <request-file>`
Submit a structured `ActionRequest`.

Examples:
```bash
acp submit action-request.json
acp submit action-request.yaml
```

Required input fields:
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

Behavior:
- store the request
- evaluate policy
- if policy returns `approval_required`, pause in approval state
- if policy returns `deny`, close the request

Output:
- `task_id`
- current state
- latest policy decision
- suggested next command

### `acp inspect <task-id>`
Inspect current state and latest decision data.

Output:
- current state
- latest policy decision
- approval status
- execution summary
- handoff status

### `acp approve <task-id> --approver <id> [--reason <code>]`
Approve a request that is waiting for human approval.

Examples:
```bash
acp approve T-1001 --approver alice
acp approve T-1001 --approver alice --reason policy_exception
```

Behavior:
- verify the task is in `approval_required`
- bind approval to task and request hash
- store the approval decision
- move the task into an executable state

### `acp execute <task-id>`
Execute an approved local `record_update` request.

Example:
```bash
acp execute T-1001
```

Behavior:
- verify the task is in `approved`
- execute the local file update for the supported resource type
- record `execution.started` and `execution.completed`
- persist the execution result
- move the task to `succeeded` or `failed`

### `acp reject <task-id> --approver <id> --reason <code>`
Reject a request that is waiting for human approval.

Example:
```bash
acp reject T-1001 --approver alice --reason policy_violation
```

Behavior:
- verify the task is in `approval_required`
- record the rejection reason
- end the task as `rejected`

### `acp handoff <task-id> --to <queue> --reason <code>`
Create a human handoff ticket.

Example:
```bash
acp handoff T-1001 --to ops-queue --reason missing_context
```

Behavior:
- verify the task is in `handoff_required` or a recognized equivalent exception state
- create a handoff ticket with the required context

### `acp complete-handoff <task-id> --resolver <id> --summary <text>`
Complete an open human handoff ticket.

Example:
```bash
acp complete-handoff T-1001 --resolver alice --summary resolved
```

Behavior:
- verify the task is in `handoff_required`
- complete the latest open handoff ticket
- record `handoff.completed`
- move the task to `handoff_completed`

### `acp audit <task-id>`
Inspect the append-only audit trail for a task.

Output:
- ordered event sequence
- state transitions
- approval or rejection history
- execution result
- failure or handoff reason

### `acp verify-audit <task-id>`
Verify the stored audit chain for a task.

Output:
- event count
- verification result
- integrity issues when present

## Exit Codes
- `0`: success
- `1`: input validation failure or invalid state transition
- `2`: target task not found
- `3`: policy rejection or approval rejection
- `4`: internal storage or executor error

Rules:
- policy rejection is a business failure and should still return exit code `3`
- internal errors should leave the system retryable where possible and return `4`
- `audit` should only fail for retrieval problems

## Error Cases
- required field missing
- unknown field or schema drift routes the request to `handoff_required`
- `approve` called from an invalid state
- `execute` called from an invalid state
- approval attempted after a request is already approved
- expired approval artifact
- payload changed after approval routes the task to `handoff_required`
- `handoff` called without a valid target
- audit append failure

## Example Flows
### 1. Normal Approval Path
```bash
acp submit action-request.json
acp inspect T-1001
acp approve T-1001 --approver alice
acp execute T-1001
acp verify-audit T-1001
acp audit T-1001
```

Expected result:
- `submit` ends in `approval_required`
- `approve` moves the task to `approved`
- `execute` moves the task to `succeeded` or `failed`
- `verify-audit` confirms the stored chain is intact
- `audit` reconstructs the full event sequence

### 2. Policy Denial Path
```bash
acp submit action-request.json
```

Expected result:
- policy returns `deny`
- task is terminated
- CLI exits with code `3`

### 3. Handoff Path
```bash
acp submit action-request.json
acp handoff T-1001 --to ops-queue --reason missing_context
acp audit T-1001
```

Expected result:
- task enters `handoff_required`
- a handoff ticket is created
- the audit history includes the handoff reason and target

## Implementation Notes
- `submit` should support only `record_update` in the MVP
- `inspect` and `audit` are the easiest read-only commands and should ship first
- `approve` and `reject` must strongly validate state transitions
- `execute` is the local demo helper for the MVP
- the first `record_update` executor should update local files only
