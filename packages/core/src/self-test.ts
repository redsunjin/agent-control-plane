import {
  assertTransitionTaskState,
  canExecuteTask,
  canTransitionTaskState,
  createActionSchemaHash,
  createAuditEvent,
  evaluatePolicy,
  resolveApprovalDecisionState,
  resolvePolicyDecisionState,
  verifyAuditChain,
} from "./index.js";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function testStateMachine(): void {
  assert(
    canTransitionTaskState("received", "policy_evaluating"),
    "received should transition to policy_evaluating",
  );
  assert(
    !canTransitionTaskState("received", "approved"),
    "received should not transition directly to approved",
  );

  assertTransitionTaskState("approval_required", "approved");

  let threw = false;

  try {
    assertTransitionTaskState("rejected", "executing");
  } catch {
    threw = true;
  }

  assert(threw, "rejected should not transition to executing");
  assert(
    resolvePolicyDecisionState("allow") === "approved",
    "allow should resolve to approved",
  );
  assert(
    resolveApprovalDecisionState("expired") === "expired",
    "expired approval should resolve to expired state",
  );
  assert(canExecuteTask("approved"), "approved should be executable");
  assert(!canExecuteTask("approval_required"), "approval_required is not executable");
}

function testPolicyEvaluator(): void {
  const request = {
    taskId: "task-policy",
    actionId: "action-policy",
    actorId: "agent-1",
    tool: "local-file-tool",
    operation: "record_update" as const,
    resourceType: "local_markdown",
    resourceId: "/tmp/policy.md",
    riskLevel: "high" as const,
    expectedEffect: "update a local markdown record",
    payload: {
      patch: "replace summary",
    },
    policyContext: {
      environment: "test",
    },
    idempotencyKey: "idem-policy",
    submittedAt: "2026-03-19T12:00:00.000Z",
  };

  const highRiskDecision = evaluatePolicy({ request });
  const unknownFieldDecision = evaluatePolicy({
    request: {
      ...request,
      taskId: "task-policy-2",
    },
    hasUnknownFields: true,
  });

  assert(
    highRiskDecision.decision === "approval_required",
    "high risk requests should require approval",
  );
  assert(
    unknownFieldDecision.decision === "handoff_required",
    "unknown fields should require handoff",
  );
  assert(
    createActionSchemaHash(request) === createActionSchemaHash(request),
    "action schema hash should be deterministic",
  );
}

function testAuditChain(): void {
  const requested = createAuditEvent({
    eventId: "evt-1",
    taskId: "task-1",
    eventType: "action.requested",
    state: "received",
    actorType: "agent",
    actorId: "agent-1",
    occurredAt: "2026-03-19T12:00:00.000Z",
    payload: {
      actionId: "action-1",
      riskLevel: "high",
    },
  });

  const approved = createAuditEvent({
    eventId: "evt-2",
    taskId: "task-1",
    eventType: "approval.decided",
    state: "approved",
    actorType: "human",
    actorId: "alice",
    occurredAt: "2026-03-19T12:01:00.000Z",
    prevEventHash: requested.eventHash,
    payload: {
      decision: "approved",
      reason: "manual_review",
    },
  });

  const validChain = verifyAuditChain([requested, approved]);

  assert(validChain.valid, `expected valid audit chain, got ${validChain.issues.join("; ")}`);

  const tampered = {
    ...requested,
    payload: {
      actionId: "action-1",
      riskLevel: "low",
    } as const,
  };

  const invalidChain = verifyAuditChain([tampered, approved]);

  assert(!invalidChain.valid, "tampered event payload should invalidate the chain");
}

function run(): void {
  testStateMachine();
  testPolicyEvaluator();
  testAuditChain();
  console.log("packages/core self-test passed");
}

run();
