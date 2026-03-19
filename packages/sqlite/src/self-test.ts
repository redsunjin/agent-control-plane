import {
  createActionSchemaHash,
  createAuditEvent,
  evaluatePolicy,
  verifyAuditChain,
  type ActionRequest,
} from "@agent-control-plane/core";

import {
  AuditIntegrityError,
  HandoffTicketNotFoundError,
  SqliteAdapter,
  TaskNotFoundError,
} from "./index.js";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function buildRequest(taskId: string): ActionRequest {
  return {
    taskId,
    actionId: `action-${taskId}`,
    actorId: "agent-1",
    tool: "local-file-tool",
    operation: "record_update",
    resourceType: "local_markdown",
    resourceId: `/tmp/${taskId}.md`,
    riskLevel: "high",
    expectedEffect: "update the local markdown record",
    payload: {
      patch: "replace summary line",
    },
    policyContext: {
      environment: "test",
    },
    idempotencyKey: `idem-${taskId}`,
    submittedAt: "2026-03-19T12:00:00.000Z",
  };
}

function testActionRequestLifecycle(): void {
  const adapter = new SqliteAdapter({ filename: ":memory:" });
  const request = buildRequest("task-1");

  const created = adapter.createActionRequest({
    request,
    state: "received",
  });

  assert(created.state === "received", "request should be created in received state");

  const fetched = adapter.getActionRequest(request.taskId);

  assert(fetched !== null, "request should be retrievable");
  assert(fetched?.taskId === request.taskId, "retrieved task id should match");
  assert(fetched?.payload !== null, "payload should be deserialized");

  const updated = adapter.updateActionRequestState(
    request.taskId,
    "approval_required",
    "2026-03-19T12:01:00.000Z",
  );

  assert(updated.state === "approval_required", "state update should persist");
  assert(
    updated.updatedAt === "2026-03-19T12:01:00.000Z",
    "updatedAt should persist state updates",
  );

  let missingTaskError = false;

  try {
    adapter.updateActionRequestState(
      "missing-task",
      "approved",
      "2026-03-19T12:02:00.000Z",
    );
  } catch (error) {
    missingTaskError = error instanceof TaskNotFoundError;
  }

  assert(missingTaskError, "missing task updates should fail");
  adapter.close();
}

function testAuditAppendAndRead(): void {
  const adapter = new SqliteAdapter({ filename: ":memory:" });
  const request = buildRequest("task-2");

  adapter.createActionRequest({
    request,
    state: "received",
  });

  const requested = createAuditEvent({
    eventId: "evt-1",
    taskId: request.taskId,
    eventType: "action.requested",
    state: "received",
    actorType: "agent",
    actorId: request.actorId,
    occurredAt: "2026-03-19T12:00:00.000Z",
    payload: {
      actionId: request.actionId,
      resourceId: request.resourceId,
    },
  });

  const approved = createAuditEvent({
    eventId: "evt-2",
    taskId: request.taskId,
    eventType: "approval.decided",
    state: "approved",
    actorType: "human",
    actorId: "alice",
    occurredAt: "2026-03-19T12:02:00.000Z",
    prevEventHash: requested.eventHash,
    payload: {
      decision: "approved",
      reason: "manual-review",
    },
  });

  adapter.appendAuditEvent(requested);
  adapter.appendAuditEvent(approved);

  const events = adapter.listAuditEvents(request.taskId);
  const chainResult = verifyAuditChain(events);

  assert(events.length === 2, "audit events should be stored");
  assert(events[0]?.eventId === "evt-1", "audit events should be returned in append order");
  assert(chainResult.valid, `stored events should verify as a chain: ${chainResult.issues.join("; ")}`);

  let badChainError = false;

  try {
    adapter.appendAuditEvent(
      createAuditEvent({
        eventId: "evt-3",
        taskId: request.taskId,
        eventType: "handoff.requested",
        state: "handoff_required",
        actorType: "system",
        actorId: "policy-engine",
        occurredAt: "2026-03-19T12:03:00.000Z",
        prevEventHash: "bad-chain",
        payload: {
          reason: "missing-context",
        },
      }),
    );
  } catch (error) {
    badChainError = error instanceof AuditIntegrityError;
  }

  assert(badChainError, "invalid audit chain should fail closed");
  adapter.close();
}

function testPolicyApprovalAndHandoffPersistence(): void {
  const adapter = new SqliteAdapter({ filename: ":memory:" });
  const request = buildRequest("task-3");

  adapter.runInTransaction(() => {
    adapter.createActionRequest({
      request,
      state: "approval_required",
    });

    const policyDecision = evaluatePolicy({ request });

    adapter.createPolicyDecision({
      policyDecisionId: "pol-1",
      ...policyDecision,
      matchedRules: policyDecision.matchedRules,
    });

    adapter.createApprovalDecision({
      approvalDecisionId: "app-1",
      taskId: request.taskId,
      actionSchemaHash: createActionSchemaHash(request),
      policyId: policyDecision.policyId,
      policyVersion: policyDecision.policyVersion,
      approverId: "alice",
      decision: "approved",
      decisionReasonCode: "manual_review",
      timestamp: "2026-03-19T12:02:00.000Z",
      expiresAt: "2026-03-19T13:02:00.000Z",
      priorDecisionId: null,
      createdAt: "2026-03-19T12:02:00.000Z",
    });

    adapter.createHandoffTicket({
      handoffTicketId: "ho-1",
      taskId: request.taskId,
      handoffReason: "missing_context",
      requiredContext: {
        queue: "ops-queue",
      },
      assignedTo: "ops-queue",
      status: "open",
      createdAt: "2026-03-19T12:03:00.000Z",
    });
  });

  const latestPolicyDecision = adapter.getLatestPolicyDecision(request.taskId);
  const latestApprovalDecision = adapter.getLatestApprovalDecision(request.taskId);
  const latestHandoffTicket = adapter.getLatestHandoffTicket(request.taskId);

  assert(
    latestPolicyDecision?.decision === "approval_required",
    "latest policy decision should be retrievable",
  );
  assert(
    latestApprovalDecision?.decision === "approved",
    "latest approval decision should be retrievable",
  );
  assert(
    latestHandoffTicket?.assignedTo === "ops-queue",
    "latest handoff ticket should be retrievable",
  );

  adapter.close();
}

function testExecutionResultPersistence(): void {
  const adapter = new SqliteAdapter({ filename: ":memory:" });
  const request = buildRequest("task-4");

  adapter.createActionRequest({
    request,
    state: "approved",
  });

  adapter.createExecutionResult({
    executionResultId: "exec-result-1",
    taskId: request.taskId,
    executionId: "exec-1",
    status: "succeeded",
    resultSummary: "updated local file",
    executorId: "local-record-update",
    startedAt: "2026-03-19T12:04:00.000Z",
    finishedAt: "2026-03-19T12:04:01.000Z",
  });

  const latestExecutionResult = adapter.getLatestExecutionResult(request.taskId);

  assert(
    latestExecutionResult?.status === "succeeded",
    "latest execution result should be retrievable",
  );

  adapter.close();
}

function testHandoffCompletionPersistence(): void {
  const adapter = new SqliteAdapter({ filename: ":memory:" });
  const request = buildRequest("task-5");

  adapter.createActionRequest({
    request,
    state: "handoff_required",
  });
  adapter.createHandoffTicket({
    handoffTicketId: "ho-2",
    taskId: request.taskId,
    handoffReason: "missing_context",
    requiredContext: {
      queue: "ops-queue",
    },
    assignedTo: "ops-queue",
    status: "open",
    createdAt: "2026-03-19T12:05:00.000Z",
  });

  const completed = adapter.completeLatestOpenHandoffTicket(
    request.taskId,
    "2026-03-19T12:06:00.000Z",
  );

  assert(completed.status === "completed", "handoff ticket should complete");
  assert(completed.closedAt === "2026-03-19T12:06:00.000Z", "handoff closedAt should persist");

  let missingHandoffError = false;

  try {
    adapter.completeLatestOpenHandoffTicket("missing-task", "2026-03-19T12:07:00.000Z");
  } catch (error) {
    missingHandoffError = error instanceof HandoffTicketNotFoundError;
  }

  assert(missingHandoffError, "missing open handoff tickets should fail");
  adapter.close();
}

function run(): void {
  testActionRequestLifecycle();
  testAuditAppendAndRead();
  testPolicyApprovalAndHandoffPersistence();
  testExecutionResultPersistence();
  testHandoffCompletionPersistence();
  console.log("packages/sqlite self-test passed");
}

run();
