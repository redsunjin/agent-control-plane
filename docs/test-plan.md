# Agent Control Plane Test Plan

## Purpose
Verify that the MVP blocks the main failure modes in code, not just in documents.

## Scope
In scope:
- state transitions
- policy decisions
- approval token binding
- execution result recording
- handoff behavior
- audit integrity

Out of scope:
- external SaaS connectors
- browser UI
- multi-tenant support

## Test Matrix
### 1. Policy Paths
- `allow`
- `deny`
- `approval_required`
- `handoff_required`

### 2. Approval Paths
- normal approval
- normal rejection
- expired approval
- reused approval
- payload mutation after approval

### 3. State Integrity
- `approve` from an invalid state
- `reject` from an invalid state
- `handoff` from an invalid state
- `executing` without `approved`

### 4. Input Integrity
- required field missing
- unknown field
- unsupported `resource_type`
- schema drift

### 5. Execution Paths
- execution success
- execution failure
- missing execution result record
- approval mismatch before execution

### 6. Handoff Paths
- handoff after policy hold
- handoff after execution failure
- handoff completion
- completion attempt for a missing ticket

### 7. Audit Paths
- append-only event verification
- `prev_event_hash` chain verification
- tampered hash detection
- fail-closed behavior on audit write failure

## Test Levels
### Unit Tests
Targets:
- state machine
- policy evaluator
- approval token validator
- event hash calculator

Goal:
- validate rules quickly and in isolation

### Integration Tests
Targets:
- SQLite persistence
- CLI commands
- `submit -> approve/reject -> execute -> audit`

Goal:
- ensure the written contracts match the implementation

### Scenario Tests
Targets:
- `record_update` approval demo
- denial flow
- handoff flow
- tampered audit flow

Goal:
- prove the operator flow works end to end

## Minimum Acceptance Criteria
- zero execution paths without approval or policy
- full end-to-end reconstruction by `task_id`
- reused approvals are blocked
- zero silent acceptance of unknown fields
- zero success responses when audit writes fail
- handoff can be created within three steps from a blocked state

## Suggested Execution Order
1. state machine unit tests
2. policy evaluator unit tests
3. approval token unit tests
4. SQLite integration tests
5. CLI scenario tests
6. failure and handoff scenario tests
7. tampered audit tests

## Release Gate
The MVP demo is ready only when all of these pass:
- `submit -> inspect -> approve -> execute -> audit`
- `submit -> deny`
- `submit -> handoff`
- tampered or missing audit causes fail-closed behavior

## First Tests To Write
Start with:
- state machine tests
- approval token tests
- audit hash-chain tests
