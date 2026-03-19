import { DatabaseSync } from "node:sqlite";

import {
  type ActionRequest,
  type AuditEventRecord,
  type JsonValue,
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

function taskIdOf(event: AuditEventRecord): string {
  return event.taskId;
}

function serializeJson(value: JsonValue): string {
  return JSON.stringify(value);
}

function parseJson(value: string): JsonValue {
  return JSON.parse(value) as JsonValue;
}
