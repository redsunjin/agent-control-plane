import { DatabaseSync } from "node:sqlite";

import {
  type ActionRequest,
  type ApprovalDecision,
  type AuditEventRecord,
  type ExecutionResult,
  type HandoffStatus,
  type JsonValue,
  type PolicyDecision,
  type HandoffTicket,
  type TaskState,
  verifyAuditEvent,
} from "@agent-control-plane/core";

import { CREATE_SCHEMA_SQL, SQLITE_SCHEMA_VERSION } from "./schema.js";

export interface SqliteAdapterOptions {
  filename: string;
  readOnly?: boolean;
}

export interface PersistedActionRequest extends ActionRequest {
  state: TaskState;
  createdAt: string;
  updatedAt: string;
}

export interface CreateActionRequestInput {
  request: ActionRequest;
  state: TaskState;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreatePolicyDecisionInput extends PolicyDecision {
  policyDecisionId: string;
  matchedRules: string[];
}

export interface PersistedPolicyDecision extends PolicyDecision {
  policyDecisionId: string;
  matchedRules: string[];
}

export interface CreateApprovalDecisionInput extends ApprovalDecision {
  approvalDecisionId: string;
  createdAt: string;
}

export interface PersistedApprovalDecision extends ApprovalDecision {
  approvalDecisionId: string;
  createdAt: string;
}

export interface CreateHandoffTicketInput extends HandoffTicket {
  handoffTicketId: string;
  closedAt?: string | null;
}

export interface PersistedHandoffTicket extends HandoffTicket {
  handoffTicketId: string;
  closedAt?: string | null;
}

export interface CreateExecutionResultInput extends ExecutionResult {
  executionResultId: string;
}

export interface PersistedExecutionResult extends ExecutionResult {
  executionResultId: string;
}

type ActionRequestRow = {
  task_id: string;
  action_id: string;
  actor_id: string;
  tool: string;
  operation: "record_update";
  resource_type: string;
  resource_id: string;
  risk_level: PersistedActionRequest["riskLevel"];
  expected_effect: string;
  payload: string;
  policy_context: string;
  idempotency_key: string;
  state: TaskState;
  created_at: string;
  updated_at: string;
};

type AuditEventRow = {
  event_id: string;
  task_id: string;
  event_type: AuditEventRecord["eventType"];
  state: TaskState;
  actor_type: AuditEventRecord["actorType"];
  actor_id: string;
  timestamp: string;
  payload: string;
  schema_version: string;
  correlation_id: string | null;
  idempotency_key: string | null;
  source: string | null;
  payload_hash: string;
  prev_event_hash: string | null;
  event_hash: string;
};

type PolicyDecisionRow = {
  policy_decision_id: string;
  task_id: string;
  policy_id: string;
  policy_version: string;
  decision: PolicyDecision["decision"];
  reason_code: string;
  evaluated_at: string;
  matched_rules: string;
};

type ApprovalDecisionRow = {
  approval_decision_id: string;
  task_id: string;
  action_schema_hash: string;
  policy_id: string;
  policy_version: string;
  approver_id: string;
  decision: ApprovalDecision["decision"];
  decision_reason_code: string;
  prior_decision_id: string | null;
  expires_at: string;
  created_at: string;
};

type HandoffTicketRow = {
  handoff_ticket_id: string;
  task_id: string;
  handoff_reason: string;
  required_context: string;
  assigned_to: string | null;
  status: HandoffTicket["status"];
  created_at: string;
  closed_at: string | null;
};

type ExecutionResultRow = {
  execution_result_id: string;
  task_id: string;
  execution_id: string;
  status: ExecutionResult["status"];
  result_summary: string;
  executor_id: string;
  started_at: string;
  finished_at: string;
};

export class AuditIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuditIntegrityError";
  }
}

export class TaskNotFoundError extends Error {
  constructor(taskId: string) {
    super(`Task not found: ${taskId}`);
    this.name = "TaskNotFoundError";
  }
}

export class HandoffTicketNotFoundError extends Error {
  constructor(taskId: string) {
    super(`Open handoff ticket not found for task: ${taskId}`);
    this.name = "HandoffTicketNotFoundError";
  }
}

export class SqliteAdapter {
  private readonly database: DatabaseSync;

  constructor(public readonly options: SqliteAdapterOptions) {
    this.database = new DatabaseSync(options.filename, {
      open: true,
      readOnly: options.readOnly ?? false,
    });
    this.database.exec(CREATE_SCHEMA_SQL);
  }

  get schemaVersion(): number {
    return SQLITE_SCHEMA_VERSION;
  }

  close(): void {
    this.database.close();
  }

  runInTransaction<T>(callback: () => T): T {
    this.database.exec("BEGIN");

    try {
      const result = callback();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  createActionRequest(input: CreateActionRequestInput): PersistedActionRequest {
    const createdAt = input.createdAt ?? input.request.submittedAt;
    const updatedAt = input.updatedAt ?? createdAt;
    const statement = this.database.prepare(`
      INSERT INTO action_requests (
        task_id,
        action_id,
        actor_id,
        tool,
        operation,
        resource_type,
        resource_id,
        risk_level,
        expected_effect,
        payload,
        policy_context,
        idempotency_key,
        state,
        created_at,
        updated_at
      ) VALUES (
        :taskId,
        :actionId,
        :actorId,
        :tool,
        :operation,
        :resourceType,
        :resourceId,
        :riskLevel,
        :expectedEffect,
        :payload,
        :policyContext,
        :idempotencyKey,
        :state,
        :createdAt,
        :updatedAt
      )
    `);

    statement.run({
      taskId: input.request.taskId,
      actionId: input.request.actionId,
      actorId: input.request.actorId,
      tool: input.request.tool,
      operation: input.request.operation,
      resourceType: input.request.resourceType,
      resourceId: input.request.resourceId,
      riskLevel: input.request.riskLevel,
      expectedEffect: input.request.expectedEffect,
      payload: serializeJson(input.request.payload),
      policyContext: serializeJson(input.request.policyContext),
      idempotencyKey: input.request.idempotencyKey,
      state: input.state,
      createdAt,
      updatedAt,
    });

    return {
      ...input.request,
      state: input.state,
      createdAt,
      updatedAt,
    };
  }

  getActionRequest(taskId: string): PersistedActionRequest | null {
    const row = this.database
      .prepare(`
        SELECT
          task_id,
          action_id,
          actor_id,
          tool,
          operation,
          resource_type,
          resource_id,
          risk_level,
          expected_effect,
          payload,
          policy_context,
          idempotency_key,
          state,
          created_at,
          updated_at
        FROM action_requests
        WHERE task_id = ?
      `)
      .get(taskId) as ActionRequestRow | undefined;

    return row === undefined ? null : mapActionRequestRow(row);
  }

  updateActionRequestState(
    taskId: string,
    state: TaskState,
    updatedAt: string,
  ): PersistedActionRequest {
    const result = this.database
      .prepare(`
        UPDATE action_requests
        SET state = ?, updated_at = ?
        WHERE task_id = ?
      `)
      .run(state, updatedAt, taskId);

    if (result.changes === 0) {
      throw new TaskNotFoundError(taskId);
    }

    const request = this.getActionRequest(taskId);

    if (request === null) {
      throw new TaskNotFoundError(taskId);
    }

    return request;
  }

  appendAuditEvent(event: AuditEventRecord): AuditEventRecord {
    const eventVerification = verifyAuditEvent(event);

    if (!eventVerification.valid) {
      throw new AuditIntegrityError(eventVerification.issues.join("; "));
    }

    const latestEvent = this.getLatestAuditEvent(taskIdOf(event));

    if (latestEvent === null) {
      if (event.prevEventHash !== undefined) {
        throw new AuditIntegrityError(
          `First event ${event.eventId} must not declare prevEventHash`,
        );
      }
    } else if (latestEvent.eventHash !== event.prevEventHash) {
      throw new AuditIntegrityError(
        `Event ${event.eventId} must chain from ${latestEvent.eventHash}, received ${event.prevEventHash ?? "undefined"}`,
      );
    }

    this.database
      .prepare(`
        INSERT INTO audit_events (
          event_id,
          task_id,
          event_type,
          state,
          actor_type,
          actor_id,
          timestamp,
          payload,
          schema_version,
          correlation_id,
          idempotency_key,
          source,
          payload_hash,
          prev_event_hash,
          event_hash
        ) VALUES (
          :eventId,
          :taskId,
          :eventType,
          :state,
          :actorType,
          :actorId,
          :occurredAt,
          :payload,
          :schemaVersion,
          :correlationId,
          :idempotencyKey,
          :source,
          :payloadHash,
          :prevEventHash,
          :eventHash
        )
      `)
      .run({
        eventId: event.eventId,
        taskId: event.taskId,
        eventType: event.eventType,
        state: event.state,
        actorType: event.actorType,
        actorId: event.actorId,
        occurredAt: event.occurredAt,
        payload: serializeJson(event.payload),
        schemaVersion: event.schemaVersion,
        correlationId: event.correlationId ?? null,
        idempotencyKey: event.idempotencyKey ?? null,
        source: event.source ?? null,
        payloadHash: event.payloadHash,
        prevEventHash: event.prevEventHash ?? null,
        eventHash: event.eventHash,
      });

    return event;
  }

  listAuditEvents(taskId: string): AuditEventRecord[] {
    const rows = this.database
      .prepare(`
        SELECT
          event_id,
          task_id,
          event_type,
          state,
          actor_type,
          actor_id,
          timestamp,
          payload,
          schema_version,
          correlation_id,
          idempotency_key,
          source,
          payload_hash,
          prev_event_hash,
          event_hash
        FROM audit_events
        WHERE task_id = ?
        ORDER BY rowid ASC
      `)
      .all(taskId) as AuditEventRow[];

    return rows.map(mapAuditEventRow);
  }

  createPolicyDecision(
    input: CreatePolicyDecisionInput,
  ): PersistedPolicyDecision {
    this.database
      .prepare(`
        INSERT INTO policy_decisions (
          policy_decision_id,
          task_id,
          policy_id,
          policy_version,
          decision,
          reason_code,
          evaluated_at,
          matched_rules
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        input.policyDecisionId,
        input.taskId,
        input.policyId,
        input.policyVersion,
        input.decision,
        input.reasonCode,
        input.evaluatedAt,
        JSON.stringify(input.matchedRules),
      );

    return {
      ...input,
    };
  }

  getLatestPolicyDecision(taskId: string): PersistedPolicyDecision | null {
    const row = this.database
      .prepare(`
        SELECT
          policy_decision_id,
          task_id,
          policy_id,
          policy_version,
          decision,
          reason_code,
          evaluated_at,
          matched_rules
        FROM policy_decisions
        WHERE task_id = ?
        ORDER BY evaluated_at DESC, rowid DESC
        LIMIT 1
      `)
      .get(taskId) as PolicyDecisionRow | undefined;

    return row === undefined ? null : mapPolicyDecisionRow(row);
  }

  createApprovalDecision(
    input: CreateApprovalDecisionInput,
  ): PersistedApprovalDecision {
    this.database
      .prepare(`
        INSERT INTO approval_decisions (
          approval_decision_id,
          task_id,
          action_schema_hash,
          policy_id,
          policy_version,
          approver_id,
          decision,
          decision_reason_code,
          prior_decision_id,
          expires_at,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        input.approvalDecisionId,
        input.taskId,
        input.actionSchemaHash,
        input.policyId,
        input.policyVersion,
        input.approverId,
        input.decision,
        input.decisionReasonCode,
        input.priorDecisionId,
        input.expiresAt,
        input.createdAt,
      );

    return {
      ...input,
    };
  }

  getLatestApprovalDecision(taskId: string): PersistedApprovalDecision | null {
    const row = this.database
      .prepare(`
        SELECT
          approval_decision_id,
          task_id,
          action_schema_hash,
          policy_id,
          policy_version,
          approver_id,
          decision,
          decision_reason_code,
          prior_decision_id,
          expires_at,
          created_at
        FROM approval_decisions
        WHERE task_id = ?
        ORDER BY created_at DESC, rowid DESC
        LIMIT 1
      `)
      .get(taskId) as ApprovalDecisionRow | undefined;

    return row === undefined ? null : mapApprovalDecisionRow(row);
  }

  createHandoffTicket(
    input: CreateHandoffTicketInput,
  ): PersistedHandoffTicket {
    this.database
      .prepare(`
        INSERT INTO handoff_tickets (
          handoff_ticket_id,
          task_id,
          handoff_reason,
          required_context,
          assigned_to,
          status,
          created_at,
          closed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        input.handoffTicketId,
        input.taskId,
        input.handoffReason,
        serializeJson(input.requiredContext),
        input.assignedTo,
        input.status,
        input.createdAt,
        input.closedAt ?? null,
      );

    return {
      ...input,
    };
  }

  getLatestHandoffTicket(taskId: string): PersistedHandoffTicket | null {
    const row = this.database
      .prepare(`
        SELECT
          handoff_ticket_id,
          task_id,
          handoff_reason,
          required_context,
          assigned_to,
          status,
          created_at,
          closed_at
        FROM handoff_tickets
        WHERE task_id = ?
        ORDER BY created_at DESC, rowid DESC
        LIMIT 1
      `)
      .get(taskId) as HandoffTicketRow | undefined;

    return row === undefined ? null : mapHandoffTicketRow(row);
  }

  completeLatestOpenHandoffTicket(
    taskId: string,
    closedAt: string,
  ): PersistedHandoffTicket {
    const row = this.database
      .prepare(`
        SELECT
          handoff_ticket_id,
          task_id,
          handoff_reason,
          required_context,
          assigned_to,
          status,
          created_at,
          closed_at
        FROM handoff_tickets
        WHERE task_id = ? AND status = 'open'
        ORDER BY created_at DESC, rowid DESC
        LIMIT 1
      `)
      .get(taskId) as HandoffTicketRow | undefined;

    if (row === undefined) {
      throw new HandoffTicketNotFoundError(taskId);
    }

    this.database
      .prepare(`
        UPDATE handoff_tickets
        SET status = ?, closed_at = ?
        WHERE handoff_ticket_id = ?
      `)
      .run("completed" satisfies HandoffStatus, closedAt, row.handoff_ticket_id);

    return {
      ...mapHandoffTicketRow(row),
      status: "completed",
      closedAt,
    };
  }

  createExecutionResult(
    input: CreateExecutionResultInput,
  ): PersistedExecutionResult {
    this.database
      .prepare(`
        INSERT INTO execution_results (
          execution_result_id,
          task_id,
          execution_id,
          status,
          result_summary,
          executor_id,
          started_at,
          finished_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        input.executionResultId,
        input.taskId,
        input.executionId,
        input.status,
        input.resultSummary,
        input.executorId,
        input.startedAt,
        input.finishedAt,
      );

    return {
      ...input,
    };
  }

  getLatestExecutionResult(taskId: string): PersistedExecutionResult | null {
    const row = this.database
      .prepare(`
        SELECT
          execution_result_id,
          task_id,
          execution_id,
          status,
          result_summary,
          executor_id,
          started_at,
          finished_at
        FROM execution_results
        WHERE task_id = ?
        ORDER BY finished_at DESC, rowid DESC
        LIMIT 1
      `)
      .get(taskId) as ExecutionResultRow | undefined;

    return row === undefined ? null : mapExecutionResultRow(row);
  }

  private getLatestAuditEvent(taskId: string): AuditEventRecord | null {
    const row = this.database
      .prepare(`
        SELECT
          event_id,
          task_id,
          event_type,
          state,
          actor_type,
          actor_id,
          timestamp,
          payload,
          schema_version,
          correlation_id,
          idempotency_key,
          source,
          payload_hash,
          prev_event_hash,
          event_hash
        FROM audit_events
        WHERE task_id = ?
        ORDER BY rowid DESC
        LIMIT 1
      `)
      .get(taskId) as AuditEventRow | undefined;

    return row === undefined ? null : mapAuditEventRow(row);
  }
}

function mapActionRequestRow(row: ActionRequestRow): PersistedActionRequest {
  return {
    taskId: row.task_id,
    actionId: row.action_id,
    actorId: row.actor_id,
    tool: row.tool,
    operation: row.operation,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    riskLevel: row.risk_level,
    expectedEffect: row.expected_effect,
    payload: parseJson(row.payload),
    policyContext: parseJson(row.policy_context),
    idempotencyKey: row.idempotency_key,
    submittedAt: row.created_at,
    state: row.state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAuditEventRow(row: AuditEventRow): AuditEventRecord {
  return {
    eventId: row.event_id,
    taskId: row.task_id,
    eventType: row.event_type,
    state: row.state,
    actorType: row.actor_type,
    actorId: row.actor_id,
    occurredAt: row.timestamp,
    payload: parseJson(row.payload),
    schemaVersion: row.schema_version,
    correlationId: row.correlation_id ?? undefined,
    idempotencyKey: row.idempotency_key ?? undefined,
    source: row.source ?? undefined,
    payloadHash: row.payload_hash,
    prevEventHash: row.prev_event_hash ?? undefined,
    eventHash: row.event_hash,
  };
}

function mapPolicyDecisionRow(row: PolicyDecisionRow): PersistedPolicyDecision {
  return {
    policyDecisionId: row.policy_decision_id,
    taskId: row.task_id,
    policyId: row.policy_id,
    policyVersion: row.policy_version,
    decision: row.decision,
    reasonCode: row.reason_code,
    evaluatedAt: row.evaluated_at,
    matchedRules: JSON.parse(row.matched_rules) as string[],
  };
}

function mapApprovalDecisionRow(
  row: ApprovalDecisionRow,
): PersistedApprovalDecision {
  return {
    approvalDecisionId: row.approval_decision_id,
    taskId: row.task_id,
    actionSchemaHash: row.action_schema_hash,
    policyId: row.policy_id,
    policyVersion: row.policy_version,
    approverId: row.approver_id,
    decision: row.decision,
    decisionReasonCode: row.decision_reason_code,
    priorDecisionId: row.prior_decision_id,
    timestamp: row.created_at,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

function mapHandoffTicketRow(row: HandoffTicketRow): PersistedHandoffTicket {
  return {
    handoffTicketId: row.handoff_ticket_id,
    taskId: row.task_id,
    handoffReason: row.handoff_reason,
    requiredContext: parseJson(row.required_context),
    assignedTo: row.assigned_to,
    status: row.status,
    createdAt: row.created_at,
    closedAt: row.closed_at,
  };
}

function mapExecutionResultRow(
  row: ExecutionResultRow,
): PersistedExecutionResult {
  return {
    executionResultId: row.execution_result_id,
    taskId: row.task_id,
    executionId: row.execution_id,
    status: row.status,
    resultSummary: row.result_summary,
    executorId: row.executor_id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

function taskIdOf(event: AuditEventRecord): string {
  return event.taskId;
}

function serializeJson(value: JsonValue): string {
  return JSON.stringify(value);
}

function parseJson(value: string): JsonValue {
  return JSON.parse(value) as JsonValue;
}
