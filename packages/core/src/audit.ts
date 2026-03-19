import type {
  AuditActorType,
  AuditEventRecord,
  AuditEventType,
  JsonValue,
  TaskState,
} from "./domain.js";

export interface CreateAuditEventInput<TPayload extends JsonValue = JsonValue> {
  eventId: string;
  taskId: string;
  eventType: AuditEventType;
  state: TaskState;
  actorType: AuditActorType;
  actorId: string;
  occurredAt: string;
  payload: TPayload;
  schemaVersion?: string;
  correlationId?: string;
  idempotencyKey?: string;
  source?: string;
  prevEventHash?: string;
}

export interface AuditChainVerificationResult {
  valid: boolean;
  issues: string[];
}

export type HashFunction = (value: string) => string;

export function canonicalizeJson(value: JsonValue): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeJson).join(",")}]`;
  }

  const objectEntries = Object.entries(value).sort(([left], [right]) =>
    left.localeCompare(right),
  );

  return `{${objectEntries
    .map(([key, nestedValue]) => `${JSON.stringify(key)}:${canonicalizeJson(nestedValue)}`)
    .join(",")}}`;
}

export function createDeterministicHash(value: string): string {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash.toString(16).padStart(8, "0");
}

export function createPayloadHash(
  payload: JsonValue,
  hash: HashFunction = createDeterministicHash,
): string {
  return hash(canonicalizeJson(payload));
}

export function createAuditEvent<TPayload extends JsonValue>(
  input: CreateAuditEventInput<TPayload>,
  hash: HashFunction = createDeterministicHash,
): AuditEventRecord<TPayload> {
  const payloadHash = createPayloadHash(input.payload, hash);
  const eventHashInput: Record<string, string | null> = {
    eventId: input.eventId,
    taskId: input.taskId,
    eventType: input.eventType,
    state: input.state,
    actorType: input.actorType,
    actorId: input.actorId,
    occurredAt: input.occurredAt,
    payloadHash,
    prevEventHash: input.prevEventHash ?? null,
    schemaVersion: input.schemaVersion ?? "v1",
    correlationId: input.correlationId ?? null,
    idempotencyKey: input.idempotencyKey ?? null,
    source: input.source ?? null,
  };

  return {
    eventId: input.eventId,
    taskId: input.taskId,
    eventType: input.eventType,
    state: input.state,
    actorType: input.actorType,
    actorId: input.actorId,
    occurredAt: input.occurredAt,
    payload: input.payload,
    payloadHash,
    prevEventHash: input.prevEventHash,
    eventHash: hash(JSON.stringify(eventHashInput)),
    schemaVersion: input.schemaVersion ?? "v1",
    correlationId: input.correlationId,
    idempotencyKey: input.idempotencyKey,
    source: input.source,
  };
}

export function verifyAuditEvent(
  event: AuditEventRecord,
  hash: HashFunction = createDeterministicHash,
): AuditChainVerificationResult {
  const expectedPayloadHash = createPayloadHash(event.payload, hash);

  if (expectedPayloadHash !== event.payloadHash) {
    return {
      valid: false,
      issues: [
        `Payload hash mismatch for event ${event.eventId}: expected ${expectedPayloadHash}, received ${event.payloadHash}`,
      ],
    };
  }

  const expectedEvent = createAuditEvent(
    {
      eventId: event.eventId,
      taskId: event.taskId,
      eventType: event.eventType,
      state: event.state,
      actorType: event.actorType,
      actorId: event.actorId,
      occurredAt: event.occurredAt,
      payload: event.payload,
      prevEventHash: event.prevEventHash,
      schemaVersion: event.schemaVersion,
      correlationId: event.correlationId,
      idempotencyKey: event.idempotencyKey,
      source: event.source,
    },
    hash,
  );

  if (expectedEvent.eventHash !== event.eventHash) {
    return {
      valid: false,
      issues: [
        `Event hash mismatch for event ${event.eventId}: expected ${expectedEvent.eventHash}, received ${event.eventHash}`,
      ],
    };
  }

  return { valid: true, issues: [] };
}

export function verifyAuditChain(
  events: readonly AuditEventRecord[],
  hash: HashFunction = createDeterministicHash,
): AuditChainVerificationResult {
  const issues: string[] = [];

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    const previousEvent = events[index - 1];
    const eventVerification = verifyAuditEvent(event, hash);

    issues.push(...eventVerification.issues);

    if (previousEvent === undefined) {
      if (event.prevEventHash !== undefined) {
        issues.push(
          `First event ${event.eventId} must not declare prevEventHash`,
        );
      }

      continue;
    }

    if (event.taskId !== previousEvent.taskId) {
      issues.push(
        `Task mismatch between ${previousEvent.eventId} and ${event.eventId}`,
      );
    }

    if (event.prevEventHash !== previousEvent.eventHash) {
      issues.push(
        `Broken audit chain at ${event.eventId}: expected prevEventHash ${previousEvent.eventHash}, received ${event.prevEventHash ?? "undefined"}`,
      );
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}
