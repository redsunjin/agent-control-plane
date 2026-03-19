# AGENTS.md

Project operating policy for `/Users/Agent/ps-workspace/agent-control-plane`.

This repository is a docs-driven MVP for an agent control plane. The highest-risk areas are:
- state-machine integrity
- approval binding and invalidation
- append-only audit guarantees
- fail-closed behavior

Do not optimize for speed at the cost of those guarantees.

## Source Of Truth

Implementation must follow the local docs in `docs/`.

Read these before changing behavior:
1. `docs/mvp-spec.md`
2. `docs/event-schema.md`
3. `docs/sqlite-schema.md`
4. `docs/cli-contract.md`
5. `docs/implementation-plan.md`
6. `docs/test-plan.md`

Rules:
- If code and docs disagree, stop and resolve the contract first.
- Do not silently change state transitions, CLI behavior, storage semantics, or audit semantics.
- If behavior changes intentionally, update `docs/` in the same task.

## Working Model

Use a hub-and-spoke model.

### Lead Agent
Owns:
- scope control
- task breakdown and sequencing
- contract approval
- cross-package API decisions
- final integration
- release readiness judgment

### Specialist Agents
Use specialists only when ownership is clear and write scopes do not overlap.

Recommended specialists:
- `Core Agent`
  - owns `packages/core`
  - domain types, state machine, policy decision model, approval rules, audit event model
- `Persistence Agent`
  - owns `packages/sqlite`
  - schema, persistence, transaction boundaries, append-only storage rules
- `CLI Agent`
  - owns `packages/cli`
  - command UX, argument validation, exit codes, operator flow wiring
- `Verification Agent`
  - owns tests and contract verification
  - unit, integration, scenario, tamper, and fail-closed validation
- `Docs Steward`
  - owns `docs/` consistency when contracts change

## Delegation Policy

- Delegate only when the subtask is concrete and bounded.
- Delegate only when the write scope is explicit.
- Never run parallel edits on shared contract surfaces in `packages/core`.
- Never let multiple agents redefine types, states, or event semantics at the same time.
- Keep at most 3 active specialists at once.
- The Lead Agent keeps ownership of contract changes and final integration.

Good parallelism:
- `packages/sqlite` implementation + verification work
- CLI read-path work + scenario-test preparation
- docs update + non-overlapping package implementation

Bad parallelism:
- two agents editing `packages/core/src/index.ts`
- CLI implementation before command contract is stable
- persistence layer inventing domain rules not defined in `packages/core` or `docs/`

## Required Task Brief

Before substantial work, define a short task brief with:
- goal
- non-goals
- owned files
- contract impact
- required verification
- acceptance criteria

If any of these are unclear, narrow the task before implementation.

## Workflow

Every non-trivial task follows this sequence:

1. `Plan`
2. `Review`
3. `Execute`
4. `Verify`
5. `Inspect`

### 1. Plan
Declare:
- what is being changed
- what is explicitly out of scope
- which package owns the change
- whether docs must change

Exit criteria:
- the task is small enough to complete safely
- file ownership is clear
- dependencies on other packages are identified

### 2. Review
Review the task against repository contracts before coding.

Must check:
- state-machine impact
- event-schema impact
- SQLite-schema impact
- CLI-contract impact
- test-plan impact

If any contract changes, update docs first or in the same task.

Exit criteria:
- no hidden contract drift
- invariants and risks are identified

### 3. Execute
Implement only within the approved scope.

Rules:
- keep changes local to the owning package when possible
- do not mix unrelated refactors into feature work
- centralize state-transition logic instead of duplicating it
- prefer fail-closed behavior when behavior is ambiguous

Exit criteria:
- implementation matches the task brief
- no unrelated files were changed without reason

### 4. Verify
Run the smallest set of checks that proves the change is safe.

Minimum expectations by change type:
- `packages/core`
  - state-machine tests
  - approval or policy tests if behavior changed
  - audit hash/integrity tests if event logic changed
- `packages/sqlite`
  - persistence integration tests
  - append-only and retrieval checks
- `packages/cli`
  - scenario tests
  - exit-code and invalid-input checks
- contract changes in `docs/`
  - implementation/docs consistency review

Exit criteria:
- verification results are explicit
- untested risk areas are called out

### 5. Inspect
Final review is done with a code-review mindset.

Inspect for:
- invalid state transitions
- execution before approval
- approval reuse or mutation bypass
- audit write failure becoming success
- docs/code drift
- package boundary violations

Exit criteria:
- known risks are documented
- task is either ready or explicitly blocked

## Project-Specific Red Lines

Never allow:
- execution before `approved`
- `approval_required` and `handoff_required` to collapse into one state
- silent acceptance of unknown fields
- fail-open behavior after audit write failure
- mutation after approval without invalidation or handoff
- undocumented CLI contract changes
- append-only audit history to be rewritten or deleted

## Verification Matrix

Use this matrix as the minimum bar.

### Core Changes
Must verify:
- allowed and forbidden state transitions
- policy outcomes
- approval binding or invalidation logic
- audit event/hash behavior

### Persistence Changes
Must verify:
- schema compatibility with docs
- write/read correctness by `task_id`
- append-only audit storage
- transaction behavior around failures

### CLI Changes
Must verify:
- command inputs and outputs
- exit codes
- happy path
- denial path
- handoff path

### Cross-Package Changes
Must verify:
- contracts still line up across `core`, `sqlite`, and `cli`
- end-to-end flow still reconstructs by `task_id`

## Definition Of Done

A task is done only if:
- scope stayed within the task brief
- docs were updated when contracts changed
- required verification was run or the gap was explicitly noted
- no red-line behavior was introduced
- final notes state what changed, what was verified, and what remains risky

## Preferred Delivery Order

Unless the user directs otherwise, implement in this order:
1. `packages/core`
2. `packages/sqlite`
3. `packages/cli` read path
4. `packages/cli` write path
5. `examples/local-record-update`
6. hardening and failure-mode coverage

## Branch And Change Hygiene

- Keep one logical change per task.
- Do not combine contract changes and unrelated cleanup.
- Prefer small, reviewable diffs.
- If a change affects multiple packages, keep ownership explicit and integrate through the Lead Agent.
