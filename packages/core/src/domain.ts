export const ACP_VERSION = "0.1.0";

export const TASK_STATES = [
  "received",
  "policy_evaluating",
  "approval_required",
  "approved",
  "rejected",
  "executing",
  "succeeded",
  "failed",
  "handoff_required",
  "handoff_completed",
  "expired",
] as const;

export type TaskState = (typeof TASK_STATES)[number];

export const POLICY_DECISION_VALUES = [
  "allow",
  "deny",
  "approval_required",
  "handoff_required",
] as const;

export type PolicyDecisionValue = (typeof POLICY_DECISION_VALUES)[number];

export const APPROVAL_DECISION_VALUES = [
  "approved",
  "rejected",
  "expired",
] as const;

export type ApprovalDecisionValue = (typeof APPROVAL_DECISION_VALUES)[number];

export const RISK_LEVELS = ["low", "medium", "high"] as const;

export type RiskLevel = (typeof RISK_LEVELS)[number];

export const EXECUTION_RESULT_STATUSES = ["succeeded", "failed"] as const;

export type ExecutionResultStatus = (typeof EXECUTION_RESULT_STATUSES)[number];

export const HANDOFF_STATUSES = ["open", "completed"] as const;

export type HandoffStatus = (typeof HANDOFF_STATUSES)[number];

export const AUDIT_EVENT_TYPES = [
  "action.requested",
  "policy.evaluated",
  "approval.requested",
  "approval.decided",
  "execution.started",
  "execution.completed",
  "handoff.requested",
  "handoff.completed",
  "audit.appended",
] as const;

export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];

export const AUDIT_ACTOR_TYPES = [
  "agent",
  "system",
  "human",
  "executor",
] as const;

export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number];

export type JsonPrimitive = boolean | number | string | null;

export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue;
}

export interface ActionRequest {
  taskId: string;
  actionId: string;
  actorId: string;
  tool: string;
  operation: "record_update";
  resourceType: string;
  resourceId: string;
  riskLevel: RiskLevel;
  expectedEffect: string;
  payload: JsonValue;
  policyContext: JsonValue;
  idempotencyKey: string;
  submittedAt: string;
}

export interface PolicyDecision {
  taskId: string;
  policyId: string;
  policyVersion: string;
  decision: PolicyDecisionValue;
  reasonCode: string;
  evaluatedAt: string;
}

export interface ApprovalDecision {
  taskId: string;
  actionSchemaHash: string;
  policyId: string;
  policyVersion: string;
  approverId: string;
  decision: ApprovalDecisionValue;
  decisionReasonCode: string;
  timestamp: string;
  expiresAt: string;
  priorDecisionId: string | null;
}

export interface ExecutionResult {
  taskId: string;
  executionId: string;
  status: ExecutionResultStatus;
  resultSummary: string;
  executorId: string;
  startedAt: string;
  finishedAt: string;
}

export interface HandoffTicket {
  taskId: string;
  handoffReason: string;
  requiredContext: JsonValue;
  assignedTo: string | null;
  status: HandoffStatus;
  createdAt: string;
}

export interface AuditEvent {
  eventId: string;
  taskId: string;
  eventType: AuditEventType;
  state: TaskState;
  actorType: AuditActorType;
  actorId: string;
  occurredAt: string;
  payloadHash: string;
  prevEventHash?: string;
  eventHash: string;
}

export interface AuditEventRecord<TPayload extends JsonValue = JsonValue>
  extends AuditEvent {
  payload: TPayload;
  schemaVersion: string;
  correlationId?: string;
  idempotencyKey?: string;
  source?: string;
}
