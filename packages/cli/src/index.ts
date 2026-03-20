#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

import {
  assertTransitionTaskState,
  createActionSchemaHash,
  createAuditEvent,
  evaluatePolicy,
  resolveApprovalDecisionState,
  resolvePolicyDecisionState,
  verifyAuditChain,
  type ActionRequest,
  type JsonObject,
  type JsonValue,
} from "@agent-control-plane/core";
import { SqliteAdapter } from "@agent-control-plane/sqlite";
import YAML from "yaml";

const EXIT_SUCCESS = 0;
const EXIT_INVALID_INPUT = 1;
const EXIT_NOT_FOUND = 2;
const EXIT_BUSINESS_FAILURE = 3;
const EXIT_INTERNAL_ERROR = 4;

type CliCommand =
  | "submit"
  | "inspect"
  | "execute"
  | "approve"
  | "reject"
  | "handoff"
  | "audit"
  | "complete-handoff"
  | "verify-audit"
  | "help";

interface ParsedArgs {
  command: CliCommand;
  taskId?: string;
  requestFile?: string;
  approverId?: string;
  reason?: string;
  handoffQueue?: string;
  resolverId?: string;
  summary?: string;
  dbFilename: string;
}

function main(argv: readonly string[]): number {
  try {
    const parsed = parseArgs(argv);

    switch (parsed.command) {
      case "help":
        printHelp();
        return EXIT_SUCCESS;
      case "inspect":
        return runInspect(parsed);
      case "submit":
        return runSubmit(parsed);
      case "approve":
        return runApprove(parsed);
      case "execute":
        return runExecute(parsed);
      case "reject":
        return runReject(parsed);
      case "handoff":
        return runHandoff(parsed);
      case "audit":
        return runAudit(parsed);
      case "complete-handoff":
        return runCompleteHandoff(parsed);
      case "verify-audit":
        return runVerifyAudit(parsed);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    return EXIT_INVALID_INPUT;
  }
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  if (argv.length === 0 || argv[0] === "help" || argv[0] === "--help" || argv[0] === "-h") {
    return {
      command: "help",
      dbFilename: resolveDbFilename(),
    };
  }

  const command = argv[0];

  if (
    command !== "submit" &&
    command !== "inspect" &&
    command !== "execute" &&
    command !== "approve" &&
    command !== "reject" &&
    command !== "handoff" &&
    command !== "audit" &&
    command !== "complete-handoff" &&
    command !== "verify-audit"
  ) {
    throw new Error(`Unknown command: ${command}`);
  }

  let taskId: string | undefined;
  let requestFile: string | undefined;
  let approverId: string | undefined;
  let reason: string | undefined;
  let handoffQueue: string | undefined;
  let resolverId: string | undefined;
  let summary: string | undefined;
  let dbFilename = resolveDbFilename();

  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--db") {
      const value = argv[index + 1];

      if (value === undefined || value.startsWith("-")) {
        throw new Error("--db requires a filename");
      }

      dbFilename = value;
      index += 1;
      continue;
    }

    if (token.startsWith("-")) {
      if (token === "--approver") {
        const value = argv[index + 1];

        if (value === undefined || value.startsWith("-")) {
          throw new Error("--approver requires an id");
        }

        approverId = value;
        index += 1;
        continue;
      }

      if (token === "--reason") {
        const value = argv[index + 1];

        if (value === undefined || value.startsWith("-")) {
          throw new Error("--reason requires a code");
        }

        reason = value;
        index += 1;
        continue;
      }

      if (token === "--to") {
        const value = argv[index + 1];

        if (value === undefined || value.startsWith("-")) {
          throw new Error("--to requires a queue");
        }

        handoffQueue = value;
        index += 1;
        continue;
      }

      if (token === "--resolver") {
        const value = argv[index + 1];

        if (value === undefined || value.startsWith("-")) {
          throw new Error("--resolver requires an id");
        }

        resolverId = value;
        index += 1;
        continue;
      }

      if (token === "--summary") {
        const value = argv[index + 1];

        if (value === undefined || value.startsWith("-")) {
          throw new Error("--summary requires text");
        }

        summary = value;
        index += 1;
        continue;
      }

      throw new Error(`Unknown option: ${token}`);
    }

    if (command === "submit") {
      if (requestFile !== undefined) {
        throw new Error(`Unexpected extra argument: ${token}`);
      }

      requestFile = token;
      continue;
    }

    if (taskId !== undefined) {
      throw new Error(`Unexpected extra argument: ${token}`);
    }

    taskId = token;
  }

  if (command === "submit") {
    if (requestFile === undefined) {
      throw new Error("submit requires a request file");
    }
  } else if (taskId === undefined) {
    throw new Error(`${command} requires a task id`);
  }

  if ((command === "approve" || command === "reject") && approverId === undefined) {
    throw new Error(`${command} requires --approver <id>`);
  }

  if (command === "reject" && reason === undefined) {
    throw new Error("reject requires --reason <code>");
  }

  if (command === "handoff") {
    if (handoffQueue === undefined) {
      throw new Error("handoff requires --to <queue>");
    }

    if (reason === undefined) {
      throw new Error("handoff requires --reason <code>");
    }
  }

  if (command === "complete-handoff") {
    if (resolverId === undefined) {
      throw new Error("complete-handoff requires --resolver <id>");
    }

    if (summary === undefined) {
      throw new Error("complete-handoff requires --summary <text>");
    }
  }

  return {
    command,
    taskId,
    requestFile,
    approverId,
    reason,
    handoffQueue,
    resolverId,
    summary,
    dbFilename,
  };
}

function runInspect(parsed: ParsedArgs): number {
  const adapter = new SqliteAdapter({ filename: parsed.dbFilename });

  try {
    const request = adapter.getActionRequest(parsed.taskId!);

    if (request === null) {
      console.error(`Task not found: ${parsed.taskId}`);
      return EXIT_NOT_FOUND;
    }

    const auditEvents = adapter.listAuditEvents(parsed.taskId!);
    const latestAuditEvent = auditEvents.at(-1);
    const latestPolicyDecision = adapter.getLatestPolicyDecision(parsed.taskId!);
    const latestApprovalDecision = adapter.getLatestApprovalDecision(parsed.taskId!);
    const latestHandoffTicket = adapter.getLatestHandoffTicket(parsed.taskId!);
    const latestExecutionResult = adapter.getLatestExecutionResult(parsed.taskId!);

    console.log(`task_id: ${request.taskId}`);
    console.log(`state: ${request.state}`);
    console.log(`action_id: ${request.actionId}`);
    console.log(`resource: ${request.resourceType}:${request.resourceId}`);
    console.log(`risk_level: ${request.riskLevel}`);
    console.log(`submitted_at: ${request.submittedAt}`);
    console.log(`updated_at: ${request.updatedAt}`);
    console.log(`latest_policy_decision: ${latestPolicyDecision?.decision ?? "not_recorded"}`);
    console.log(`policy_reason: ${latestPolicyDecision?.reasonCode ?? "not_recorded"}`);
    console.log(
      `approval_status: ${latestApprovalDecision?.decision ?? deriveApprovalStatus(request.state)}`,
    );
    console.log(
      `execution_status: ${latestExecutionResult?.status ?? deriveExecutionStatus(request.state)}`,
    );
    console.log(
      `execution_summary: ${latestExecutionResult?.resultSummary ?? "not_recorded"}`,
    );
    console.log(
      `handoff_status: ${latestHandoffTicket?.status ?? deriveHandoffStatus(request.state)}`,
    );
    console.log(`audit_event_count: ${auditEvents.length}`);
    console.log(`latest_audit_event: ${latestAuditEvent?.eventType ?? "none"}`);

    return EXIT_SUCCESS;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    return EXIT_INTERNAL_ERROR;
  } finally {
    adapter.close();
  }
}

function runExecute(parsed: ParsedArgs): number {
  const adapter = new SqliteAdapter({ filename: parsed.dbFilename });

  try {
    const request = adapter.getActionRequest(parsed.taskId!);

    if (request === null) {
      console.error(`Task not found: ${parsed.taskId}`);
      return EXIT_NOT_FOUND;
    }

    if (request.state !== "approved") {
      console.error(`Task ${request.taskId} is not ready for execution`);
      return EXIT_INVALID_INPUT;
    }

    const latestApprovalDecision = adapter.getLatestApprovalDecision(request.taskId);
    const currentActionSchemaHash = createActionSchemaHash(request);

    if (latestApprovalDecision !== null) {
      const expiresAt = Date.parse(latestApprovalDecision.expiresAt);

      if (!Number.isNaN(expiresAt) && expiresAt <= Date.now()) {
        const expiredAt = new Date().toISOString();
        const latestAuditEvent = adapter.listAuditEvents(request.taskId).at(-1);

        adapter.runInTransaction(() => {
          adapter.createApprovalDecision({
            approvalDecisionId: `${request.taskId}:approval:expired`,
            taskId: request.taskId,
            actionSchemaHash: latestApprovalDecision.actionSchemaHash,
            policyId: latestApprovalDecision.policyId,
            policyVersion: latestApprovalDecision.policyVersion,
            approverId: "approval-guard",
            decision: "expired",
            decisionReasonCode: "approval_expired",
            timestamp: expiredAt,
            expiresAt: latestApprovalDecision.expiresAt,
            priorDecisionId: latestApprovalDecision.approvalDecisionId,
            createdAt: expiredAt,
          });
          assertTransitionTaskState(request.state, "expired");
          adapter.updateActionRequestState(request.taskId, "expired", expiredAt);
          adapter.appendAuditEvent(
            createAuditEvent({
              eventId: `${request.taskId}:approval.decided:expired`,
              taskId: request.taskId,
              eventType: "approval.decided",
              state: "expired",
              actorType: "system",
              actorId: "approval-guard",
              occurredAt: expiredAt,
              prevEventHash: latestAuditEvent?.eventHash,
              payload: {
                decision: "expired",
                decisionReasonCode: "approval_expired",
                actionSchemaHash: latestApprovalDecision.actionSchemaHash,
                originalExpiresAt: latestApprovalDecision.expiresAt,
              },
            }),
          );
        });

        console.error(`approval artifact expired for task ${request.taskId}`);
        return EXIT_INVALID_INPUT;
      }

      if (latestApprovalDecision.actionSchemaHash !== currentActionSchemaHash) {
        const mismatchAt = new Date().toISOString();
        const latestAuditEvent = adapter.listAuditEvents(request.taskId).at(-1);

        adapter.runInTransaction(() => {
          assertTransitionTaskState(request.state, "handoff_required");
          adapter.updateActionRequestState(request.taskId, "handoff_required", mismatchAt);
          adapter.createHandoffTicket({
            handoffTicketId: `${request.taskId}:handoff:approval-mismatch`,
            taskId: request.taskId,
            handoffReason: "approval_payload_mismatch",
            requiredContext: {
              expectedActionSchemaHash: latestApprovalDecision.actionSchemaHash,
              actualActionSchemaHash: currentActionSchemaHash,
            },
            assignedTo: "ops-queue",
            status: "open",
            createdAt: mismatchAt,
          });
          adapter.appendAuditEvent(
            createAuditEvent({
              eventId: `${request.taskId}:handoff.requested:approval-mismatch`,
              taskId: request.taskId,
              eventType: "handoff.requested",
              state: "handoff_required",
              actorType: "system",
              actorId: "approval-guard",
              occurredAt: mismatchAt,
              prevEventHash: latestAuditEvent?.eventHash,
              payload: {
                handoffReason: "approval_payload_mismatch",
                assignedTo: "ops-queue",
              },
            }),
          );
        });

        console.error(
          `approval-bound action hash mismatch for task ${request.taskId}; task moved to handoff_required`,
        );
        return EXIT_INTERNAL_ERROR;
      }
    }

    const startedAt = new Date().toISOString();
    const latestAuditEvent = adapter.listAuditEvents(request.taskId).at(-1);
    const executionId = `${request.taskId}:execution`;
    const executionStartedEvent = createAuditEvent({
      eventId: `${request.taskId}:execution.started`,
      taskId: request.taskId,
      eventType: "execution.started",
      state: "executing",
      actorType: "executor",
      actorId: "local-record-update",
      occurredAt: startedAt,
      prevEventHash: latestAuditEvent?.eventHash,
      payload: {
        executionId,
        resourceType: request.resourceType,
        resourceId: request.resourceId,
      },
    });

    adapter.runInTransaction(() => {
      assertTransitionTaskState(request.state, "executing");
      adapter.updateActionRequestState(request.taskId, "executing", startedAt);
      adapter.appendAuditEvent(executionStartedEvent);
    });

    let originalContents: string | undefined;
    const hadOriginalFile = existsSync(request.resourceId);

    if (hadOriginalFile) {
      originalContents = readFileSync(request.resourceId, "utf8");
    }

    try {
      const writeResult = applyLocalRecordUpdate(request);
      const completedAt = new Date().toISOString();

      adapter.runInTransaction(() => {
        adapter.createExecutionResult({
          executionResultId: `${request.taskId}:execution-result`,
          taskId: request.taskId,
          executionId,
          status: "succeeded",
          resultSummary: writeResult.summary,
          executorId: "local-record-update",
          startedAt,
          finishedAt: completedAt,
        });
        assertTransitionTaskState("executing", "succeeded");
        adapter.updateActionRequestState(request.taskId, "succeeded", completedAt);
        adapter.appendAuditEvent(
          createAuditEvent({
            eventId: `${request.taskId}:execution.completed`,
            taskId: request.taskId,
            eventType: "execution.completed",
            state: "succeeded",
            actorType: "executor",
            actorId: "local-record-update",
            occurredAt: completedAt,
            prevEventHash: executionStartedEvent.eventHash,
            payload: {
              executionId,
              status: "succeeded",
              resultSummary: writeResult.summary,
            },
          }),
        );
      });
    } catch (error) {
      restoreOriginalFile(request.resourceId, originalContents, hadOriginalFile);

      const failureAt = new Date().toISOString();
      const failureSummary =
        error instanceof Error ? error.message : String(error);

      try {
        adapter.runInTransaction(() => {
          adapter.createExecutionResult({
            executionResultId: `${request.taskId}:execution-result:failed`,
            taskId: request.taskId,
            executionId,
            status: "failed",
            resultSummary: failureSummary,
            executorId: "local-record-update",
            startedAt,
            finishedAt: failureAt,
          });
          assertTransitionTaskState("executing", "failed");
          adapter.updateActionRequestState(request.taskId, "failed", failureAt);
          adapter.appendAuditEvent(
            createAuditEvent({
              eventId: `${request.taskId}:execution.completed:failed`,
              taskId: request.taskId,
              eventType: "execution.completed",
              state: "failed",
              actorType: "executor",
              actorId: "local-record-update",
              occurredAt: failureAt,
              prevEventHash: executionStartedEvent.eventHash,
              payload: {
                executionId,
                status: "failed",
                resultSummary: failureSummary,
              },
            }),
          );
        });
      } catch {
        // Preserve fail-closed behavior by surfacing the execution error after best-effort recording.
      }

      console.error(failureSummary);
      return EXIT_INTERNAL_ERROR;
    }

    console.log(`task_id: ${request.taskId}`);
    console.log(`state: succeeded`);
    console.log(`execution_id: ${executionId}`);
    console.log(`executor_id: local-record-update`);
    return EXIT_SUCCESS;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    return EXIT_INTERNAL_ERROR;
  } finally {
    adapter.close();
  }
}

function runSubmit(parsed: ParsedArgs): number {
  const adapter = new SqliteAdapter({ filename: parsed.dbFilename });
  let loadedRequest: ReturnType<typeof loadActionRequest>;

  try {
    loadedRequest = loadActionRequest(parsed.requestFile!);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    return EXIT_INVALID_INPUT;
  }

  try {
    const { request, unknownFields } = loadedRequest;
    const policyDecision = evaluatePolicy({
      request,
      hasUnknownFields: unknownFields.length > 0,
      evaluatedAt: request.submittedAt,
    });
    const nextState = resolvePolicyDecisionState(policyDecision.decision);

    adapter.runInTransaction(() => {
      adapter.createActionRequest({
        request,
        state: "received",
      });

      const requestedEvent = createAuditEvent({
        eventId: `${request.taskId}:action.requested`,
        taskId: request.taskId,
        eventType: "action.requested",
        state: "received",
        actorType: "agent",
        actorId: request.actorId,
        occurredAt: request.submittedAt,
        payload: {
          actionId: request.actionId,
          tool: request.tool,
          operation: request.operation,
          resourceType: request.resourceType,
          resourceId: request.resourceId,
          riskLevel: request.riskLevel,
          expectedEffect: request.expectedEffect,
          policyContext: request.policyContext,
          idempotencyKey: request.idempotencyKey,
        },
      });

      adapter.appendAuditEvent(requestedEvent);
      adapter.createPolicyDecision({
        policyDecisionId: `${request.taskId}:policy`,
        ...policyDecision,
        matchedRules: policyDecision.matchedRules,
      });
      adapter.updateActionRequestState(request.taskId, nextState, policyDecision.evaluatedAt);

      const policyEvent = createAuditEvent({
        eventId: `${request.taskId}:policy.evaluated`,
        taskId: request.taskId,
        eventType: "policy.evaluated",
        state: nextState,
        actorType: "system",
        actorId: "policy-engine",
        occurredAt: policyDecision.evaluatedAt,
        prevEventHash: requestedEvent.eventHash,
        payload: {
          policyId: policyDecision.policyId,
          policyVersion: policyDecision.policyVersion,
          decision: policyDecision.decision,
          reasonCode: policyDecision.reasonCode,
          matchedRules: policyDecision.matchedRules,
          unknownFields,
        },
      });

      adapter.appendAuditEvent(policyEvent);

      if (nextState === "approval_required") {
        adapter.appendAuditEvent(
          createAuditEvent({
            eventId: `${request.taskId}:approval.requested`,
            taskId: request.taskId,
            eventType: "approval.requested",
            state: "approval_required",
            actorType: "system",
            actorId: "policy-engine",
            occurredAt: policyDecision.evaluatedAt,
            prevEventHash: policyEvent.eventHash,
            payload: {
              policyId: policyDecision.policyId,
              policyVersion: policyDecision.policyVersion,
              actionSchemaHash: createActionSchemaHash(request),
              resourceScope: `${request.resourceType}:${request.resourceId}`,
              approvalSummary: policyDecision.reasonCode,
            },
          }),
        );
      }
    });

    console.log(`task_id: ${request.taskId}`);
    console.log(`state: ${nextState}`);
    console.log(`policy_decision: ${policyDecision.decision}`);
    console.log(`reason_code: ${policyDecision.reasonCode}`);
    console.log(`next_command: ${suggestNextCommand(nextState, request.taskId)}`);

    return nextState === "rejected" ? EXIT_BUSINESS_FAILURE : EXIT_SUCCESS;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    return EXIT_INTERNAL_ERROR;
  } finally {
    adapter.close();
  }
}

function runApprove(parsed: ParsedArgs): number {
  const adapter = new SqliteAdapter({ filename: parsed.dbFilename });

  try {
    const request = adapter.getActionRequest(parsed.taskId!);

    if (request === null) {
      console.error(`Task not found: ${parsed.taskId}`);
      return EXIT_NOT_FOUND;
    }

    if (request.state !== "approval_required") {
      console.error(`Task ${request.taskId} is not awaiting approval`);
      return EXIT_INVALID_INPUT;
    }

    const latestPolicyDecision = adapter.getLatestPolicyDecision(request.taskId);

    if (latestPolicyDecision === null) {
      console.error(`Task ${request.taskId} has no recorded policy decision`);
      return EXIT_INTERNAL_ERROR;
    }

    const latestAuditEvent = adapter.listAuditEvents(request.taskId).at(-1);
    const approvedAt = new Date().toISOString();
    const nextState = resolveApprovalDecisionState("approved");

    adapter.runInTransaction(() => {
      adapter.createApprovalDecision({
        approvalDecisionId: `${request.taskId}:approval:approved`,
        taskId: request.taskId,
        actionSchemaHash: createActionSchemaHash(request),
        policyId: latestPolicyDecision.policyId,
        policyVersion: latestPolicyDecision.policyVersion,
        approverId: parsed.approverId!,
        decision: "approved",
        decisionReasonCode: parsed.reason ?? "manual_approval",
        timestamp: approvedAt,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        priorDecisionId: null,
        createdAt: approvedAt,
      });

      assertTransitionTaskState(request.state, nextState);
      adapter.updateActionRequestState(request.taskId, nextState, approvedAt);
      adapter.appendAuditEvent(
        createAuditEvent({
          eventId: `${request.taskId}:approval.decided`,
          taskId: request.taskId,
          eventType: "approval.decided",
          state: nextState,
          actorType: "human",
          actorId: parsed.approverId!,
          occurredAt: approvedAt,
          prevEventHash: latestAuditEvent?.eventHash,
          payload: {
            decision: "approved",
            decisionReasonCode: parsed.reason ?? "manual_approval",
            actionSchemaHash: createActionSchemaHash(request),
          },
        }),
      );
    });

    console.log(`task_id: ${request.taskId}`);
    console.log(`state: ${nextState}`);
    console.log(`approval_decision: approved`);
    return EXIT_SUCCESS;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    return EXIT_INTERNAL_ERROR;
  } finally {
    adapter.close();
  }
}

function runReject(parsed: ParsedArgs): number {
  const adapter = new SqliteAdapter({ filename: parsed.dbFilename });

  try {
    const request = adapter.getActionRequest(parsed.taskId!);

    if (request === null) {
      console.error(`Task not found: ${parsed.taskId}`);
      return EXIT_NOT_FOUND;
    }

    if (request.state !== "approval_required") {
      console.error(`Task ${request.taskId} is not awaiting approval`);
      return EXIT_INVALID_INPUT;
    }

    const latestPolicyDecision = adapter.getLatestPolicyDecision(request.taskId);

    if (latestPolicyDecision === null) {
      console.error(`Task ${request.taskId} has no recorded policy decision`);
      return EXIT_INTERNAL_ERROR;
    }

    const latestAuditEvent = adapter.listAuditEvents(request.taskId).at(-1);
    const rejectedAt = new Date().toISOString();
    const nextState = resolveApprovalDecisionState("rejected");

    adapter.runInTransaction(() => {
      adapter.createApprovalDecision({
        approvalDecisionId: `${request.taskId}:approval:rejected`,
        taskId: request.taskId,
        actionSchemaHash: createActionSchemaHash(request),
        policyId: latestPolicyDecision.policyId,
        policyVersion: latestPolicyDecision.policyVersion,
        approverId: parsed.approverId!,
        decision: "rejected",
        decisionReasonCode: parsed.reason!,
        timestamp: rejectedAt,
        expiresAt: rejectedAt,
        priorDecisionId: null,
        createdAt: rejectedAt,
      });

      assertTransitionTaskState(request.state, nextState);
      adapter.updateActionRequestState(request.taskId, nextState, rejectedAt);
      adapter.appendAuditEvent(
        createAuditEvent({
          eventId: `${request.taskId}:approval.decided`,
          taskId: request.taskId,
          eventType: "approval.decided",
          state: nextState,
          actorType: "human",
          actorId: parsed.approverId!,
          occurredAt: rejectedAt,
          prevEventHash: latestAuditEvent?.eventHash,
          payload: {
            decision: "rejected",
            decisionReasonCode: parsed.reason!,
            actionSchemaHash: createActionSchemaHash(request),
          },
        }),
      );
    });

    console.log(`task_id: ${request.taskId}`);
    console.log(`state: ${nextState}`);
    console.log(`approval_decision: rejected`);
    return EXIT_BUSINESS_FAILURE;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    return EXIT_INTERNAL_ERROR;
  } finally {
    adapter.close();
  }
}

function runHandoff(parsed: ParsedArgs): number {
  const adapter = new SqliteAdapter({ filename: parsed.dbFilename });

  try {
    const request = adapter.getActionRequest(parsed.taskId!);

    if (request === null) {
      console.error(`Task not found: ${parsed.taskId}`);
      return EXIT_NOT_FOUND;
    }

    if (
      request.state !== "approval_required" &&
      request.state !== "failed" &&
      request.state !== "handoff_required"
    ) {
      console.error(`Task ${request.taskId} cannot be handed off from state ${request.state}`);
      return EXIT_INVALID_INPUT;
    }

    const handoffAt = new Date().toISOString();
    const latestAuditEvent = adapter.listAuditEvents(request.taskId).at(-1);
    const nextState = request.state === "handoff_required" ? "handoff_required" : "handoff_required";

    adapter.runInTransaction(() => {
      if (request.state !== "handoff_required") {
        assertTransitionTaskState(request.state, nextState);
        adapter.updateActionRequestState(request.taskId, nextState, handoffAt);
      }

      adapter.createHandoffTicket({
        handoffTicketId: `${request.taskId}:handoff`,
        taskId: request.taskId,
        handoffReason: parsed.reason!,
        requiredContext: {
          resourceType: request.resourceType,
          resourceId: request.resourceId,
          currentState: request.state,
        },
        assignedTo: parsed.handoffQueue!,
        status: "open",
        createdAt: handoffAt,
      });

      adapter.appendAuditEvent(
        createAuditEvent({
          eventId: `${request.taskId}:handoff.requested`,
          taskId: request.taskId,
          eventType: "handoff.requested",
          state: nextState,
          actorType: "human",
          actorId: parsed.handoffQueue!,
          occurredAt: handoffAt,
          prevEventHash: latestAuditEvent?.eventHash,
          payload: {
            handoffReason: parsed.reason!,
            assignedTo: parsed.handoffQueue!,
          },
        }),
      );
    });

    console.log(`task_id: ${request.taskId}`);
    console.log(`state: ${nextState}`);
    console.log(`assigned_to: ${parsed.handoffQueue!}`);
    console.log(`handoff_reason: ${parsed.reason!}`);
    return EXIT_SUCCESS;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    return EXIT_INTERNAL_ERROR;
  } finally {
    adapter.close();
  }
}

function runCompleteHandoff(parsed: ParsedArgs): number {
  const adapter = new SqliteAdapter({ filename: parsed.dbFilename });

  try {
    const request = adapter.getActionRequest(parsed.taskId!);

    if (request === null) {
      console.error(`Task not found: ${parsed.taskId}`);
      return EXIT_NOT_FOUND;
    }

    if (request.state !== "handoff_required") {
      console.error(`Task ${request.taskId} is not awaiting handoff completion`);
      return EXIT_INVALID_INPUT;
    }

    const completedAt = new Date().toISOString();
    const latestAuditEvent = adapter.listAuditEvents(request.taskId).at(-1);

    adapter.runInTransaction(() => {
      adapter.completeLatestOpenHandoffTicket(request.taskId, completedAt);
      assertTransitionTaskState(request.state, "handoff_completed");
      adapter.updateActionRequestState(request.taskId, "handoff_completed", completedAt);
      adapter.appendAuditEvent(
        createAuditEvent({
          eventId: `${request.taskId}:handoff.completed`,
          taskId: request.taskId,
          eventType: "handoff.completed",
          state: "handoff_completed",
          actorType: "human",
          actorId: parsed.resolverId!,
          occurredAt: completedAt,
          prevEventHash: latestAuditEvent?.eventHash,
          payload: {
            assignedTo: parsed.resolverId!,
            resolutionSummary: parsed.summary!,
          },
        }),
      );
    });

    console.log(`task_id: ${request.taskId}`);
    console.log(`state: handoff_completed`);
    console.log(`resolver: ${parsed.resolverId!}`);
    console.log(`summary: ${parsed.summary!}`);
    return EXIT_SUCCESS;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    return EXIT_INTERNAL_ERROR;
  } finally {
    adapter.close();
  }
}

function runAudit(parsed: ParsedArgs): number {
  const adapter = new SqliteAdapter({ filename: parsed.dbFilename });

  try {
    const request = adapter.getActionRequest(parsed.taskId!);

    if (request === null) {
      console.error(`Task not found: ${parsed.taskId}`);
      return EXIT_NOT_FOUND;
    }

    const events = adapter.listAuditEvents(parsed.taskId!);

    console.log(`task_id: ${parsed.taskId}`);
    console.log(`event_count: ${events.length}`);

    for (const event of events) {
      console.log("---");
      console.log(`event_id: ${event.eventId}`);
      console.log(`event_type: ${event.eventType}`);
      console.log(`state: ${event.state}`);
      console.log(`actor: ${event.actorType}:${event.actorId}`);
      console.log(`occurred_at: ${event.occurredAt}`);
      console.log(`payload_hash: ${event.payloadHash}`);
      console.log(`prev_event_hash: ${event.prevEventHash ?? "none"}`);
      console.log(`event_hash: ${event.eventHash}`);
      console.log(`payload: ${JSON.stringify(event.payload)}`);
    }

    return EXIT_SUCCESS;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    return EXIT_INTERNAL_ERROR;
  } finally {
    adapter.close();
  }
}

function runVerifyAudit(parsed: ParsedArgs): number {
  const adapter = new SqliteAdapter({ filename: parsed.dbFilename });

  try {
    const request = adapter.getActionRequest(parsed.taskId!);

    if (request === null) {
      console.error(`Task not found: ${parsed.taskId}`);
      return EXIT_NOT_FOUND;
    }

    const events = adapter.listAuditEvents(parsed.taskId!);
    const result = verifyAuditChain(events);

    console.log(`task_id: ${parsed.taskId}`);
    console.log(`event_count: ${events.length}`);
    console.log(`audit_valid: ${result.valid ? "true" : "false"}`);

    if (!result.valid) {
      for (const issue of result.issues) {
        console.log(`issue: ${issue}`);
      }

      return EXIT_INTERNAL_ERROR;
    }

    return EXIT_SUCCESS;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    return EXIT_INTERNAL_ERROR;
  } finally {
    adapter.close();
  }
}

function resolveDbFilename(): string {
  return process.env.ACP_DB_FILE || "acp.sqlite";
}

function deriveApprovalStatus(state: string): string {
  switch (state) {
    case "approval_required":
      return "pending";
    case "approved":
    case "executing":
    case "succeeded":
    case "failed":
      return "approved";
    case "expired":
      return "expired";
    default:
      return "not_recorded";
  }
}

function deriveExecutionStatus(state: string): string {
  switch (state) {
    case "executing":
      return "executing";
    case "succeeded":
      return "succeeded";
    case "failed":
      return "failed";
    default:
      return "not_recorded";
  }
}

function deriveHandoffStatus(state: string): string {
  switch (state) {
    case "handoff_required":
      return "open";
    case "handoff_completed":
      return "completed";
    default:
      return "not_recorded";
  }
}

function printHelp(): void {
  console.log("Usage:");
  console.log("  acp submit <request-file> [--db <filename>]");
  console.log("  acp inspect <task-id> [--db <filename>]");
  console.log("  acp execute <task-id> [--db <filename>]");
  console.log("  acp approve <task-id> --approver <id> [--reason <code>] [--db <filename>]");
  console.log("  acp reject <task-id> --approver <id> --reason <code> [--db <filename>]");
  console.log("  acp handoff <task-id> --to <queue> --reason <code> [--db <filename>]");
  console.log("  acp complete-handoff <task-id> --resolver <id> --summary <text> [--db <filename>]");
  console.log("  acp audit <task-id> [--db <filename>]");
  console.log("  acp verify-audit <task-id> [--db <filename>]");
  console.log("");
  console.log("Environment:");
  console.log("  ACP_DB_FILE  Default SQLite filename");
}

function loadActionRequest(filename: string): {
  request: ActionRequest;
  unknownFields: string[];
} {
  const raw = readFileSync(filename, "utf8");
  const parsed = parseStructuredDocument(filename, raw);

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Request file must contain an object: ${filename}`);
  }

  const allowedKeys = new Set([
    "task_id",
    "action_id",
    "actor_id",
    "tool",
    "operation",
    "resource_type",
    "resource_id",
    "risk_level",
    "expected_effect",
    "payload",
    "policy_context",
    "idempotency_key",
    "submitted_at",
  ]);

  const unknownFields = Object.keys(parsed).filter((key) => !allowedKeys.has(key));
  const object = parsed as JsonObject;

  return {
    request: {
      taskId: getRequiredString(object, "task_id"),
      actionId: getRequiredString(object, "action_id"),
      actorId: getRequiredString(object, "actor_id"),
      tool: getRequiredString(object, "tool"),
      operation: getRequiredOperation(object),
      resourceType: getRequiredString(object, "resource_type"),
      resourceId: getRequiredString(object, "resource_id"),
      riskLevel: getRequiredRiskLevel(object),
      expectedEffect: getRequiredString(object, "expected_effect"),
      payload: getRequiredJsonValue(object, "payload"),
      policyContext: getRequiredJsonValue(object, "policy_context"),
      idempotencyKey: getRequiredString(object, "idempotency_key"),
      submittedAt: getRequiredString(object, "submitted_at"),
    },
    unknownFields,
  };
}

function parseStructuredDocument(filename: string, source: string): JsonValue {
  const name = basename(filename).toLowerCase();

  if (name.endsWith(".yaml") || name.endsWith(".yml")) {
    return YAML.parse(source) as JsonValue;
  }

  return JSON.parse(source) as JsonValue;
}

function getRequiredString(object: JsonObject, key: string): string {
  const value = object[key];

  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing or invalid string field: ${key}`);
  }

  return value;
}

function getRequiredJsonValue(object: JsonObject, key: string): JsonValue {
  if (!(key in object)) {
    throw new Error(`Missing required field: ${key}`);
  }

  return object[key] as JsonValue;
}

function getRequiredOperation(object: JsonObject): ActionRequest["operation"] {
  const operation = getRequiredString(object, "operation");

  if (operation !== "record_update") {
    throw new Error(`Unsupported operation: ${operation}`);
  }

  return operation;
}

function getRequiredRiskLevel(object: JsonObject): ActionRequest["riskLevel"] {
  const riskLevel = getRequiredString(object, "risk_level");

  if (riskLevel !== "low" && riskLevel !== "medium" && riskLevel !== "high") {
    throw new Error(`Unsupported risk_level: ${riskLevel}`);
  }

  return riskLevel;
}

function suggestNextCommand(state: string, taskId: string): string {
  switch (state) {
    case "approval_required":
      return `acp approve ${taskId} --approver <id>`;
    case "approved":
      return `acp execute ${taskId}`;
    case "rejected":
      return `acp audit ${taskId}`;
    case "handoff_required":
      return `acp handoff ${taskId} --to <queue> --reason <code>`;
    default:
      return `acp inspect ${taskId}`;
  }
}

function applyLocalRecordUpdate(request: ActionRequest): { summary: string } {
  mkdirSync(dirnameOf(request.resourceId), { recursive: true });

  if (request.resourceType === "local_markdown") {
    if (
      typeof request.payload !== "object" ||
      request.payload === null ||
      Array.isArray(request.payload) ||
      typeof request.payload.content !== "string"
    ) {
      throw new Error("local_markdown execution requires payload.content");
    }

    writeFileSync(request.resourceId, request.payload.content, "utf8");
    return { summary: `wrote markdown file ${request.resourceId}` };
  }

  if (request.resourceType === "local_json") {
    if (
      typeof request.payload !== "object" ||
      request.payload === null ||
      Array.isArray(request.payload) ||
      !("document" in request.payload)
    ) {
      throw new Error("local_json execution requires payload.document");
    }

    writeFileSync(
      request.resourceId,
      `${JSON.stringify(request.payload.document, null, 2)}\n`,
      "utf8",
    );
    return { summary: `wrote json file ${request.resourceId}` };
  }

  throw new Error(`unsupported executor resource_type: ${request.resourceType}`);
}

function restoreOriginalFile(
  filename: string,
  originalContents: string | undefined,
  hadOriginalFile: boolean,
): void {
  if (!hadOriginalFile) {
    rmSync(filename, { force: true });
    return;
  }

  writeFileSync(filename, originalContents ?? "", "utf8");
}

function dirnameOf(pathname: string): string {
  const lastSlash = pathname.lastIndexOf("/");
  return lastSlash <= 0 ? "." : pathname.slice(0, lastSlash);
}

process.exitCode = main(process.argv.slice(2));
