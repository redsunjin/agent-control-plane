import type {
  ActionRequest,
  JsonValue,
  PolicyDecision,
  PolicyDecisionValue,
} from "./domain.js";
import { createPayloadHash } from "./audit.js";

export interface EvaluatePolicyInput {
  request: ActionRequest;
  hasUnknownFields?: boolean;
  policyId?: string;
  policyVersion?: string;
  evaluatedAt?: string;
}

export interface EvaluatedPolicyDecision extends PolicyDecision {
  matchedRules: string[];
}

export function evaluatePolicy(input: EvaluatePolicyInput): EvaluatedPolicyDecision {
  const policyId = input.policyId ?? "mvp-default-policy";
  const policyVersion = input.policyVersion ?? "v1";
  const evaluatedAt = input.evaluatedAt ?? input.request.submittedAt;
  const matchedRules: string[] = [];

  let decision: PolicyDecisionValue;
  let reasonCode: string;

  if (input.hasUnknownFields === true) {
    decision = "handoff_required";
    reasonCode = "schema_drift";
    matchedRules.push("unknown_fields_require_handoff");
  } else if (!isSupportedResourceType(input.request.resourceType)) {
    decision = "deny";
    reasonCode = "unsupported_resource_type";
    matchedRules.push("unsupported_resource_type_denied");
  } else if (input.request.riskLevel === "high") {
    decision = "approval_required";
    reasonCode = "high_risk_requires_approval";
    matchedRules.push("high_risk_requires_approval");
  } else if (input.request.riskLevel === "low" && isLocalScope(input.request.resourceType)) {
    decision = "allow";
    reasonCode = "local_low_risk_allow";
    matchedRules.push("local_low_risk_allow");
  } else {
    decision = "approval_required";
    reasonCode = "default_manual_review";
    matchedRules.push("default_manual_review");
  }

  return {
    taskId: input.request.taskId,
    policyId,
    policyVersion,
    decision,
    reasonCode,
    evaluatedAt,
    matchedRules,
  };
}

export function createActionSchemaHash(request: ActionRequest): string {
  return createPayloadHash({
    taskId: request.taskId,
    operation: request.operation,
    resourceType: request.resourceType,
    resourceId: request.resourceId,
    riskLevel: request.riskLevel,
    payload: request.payload,
  } satisfies JsonValue);
}

export function isSupportedResourceType(resourceType: string): boolean {
  return resourceType === "local_json" || resourceType === "local_markdown";
}

export function isLocalScope(resourceType: string): boolean {
  return resourceType.startsWith("local_");
}
