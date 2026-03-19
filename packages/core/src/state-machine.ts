import type {
  ApprovalDecisionValue,
  PolicyDecisionValue,
  TaskState,
} from "./domain.js";

export const TASK_STATE_TRANSITIONS: Record<TaskState, readonly TaskState[]> = {
  received: ["policy_evaluating"],
  policy_evaluating: [
    "rejected",
    "approved",
    "approval_required",
    "handoff_required",
  ],
  approval_required: [
    "approved",
    "rejected",
    "expired",
    "handoff_required",
  ],
  approved: ["executing"],
  rejected: [],
  executing: ["succeeded", "failed"],
  succeeded: [],
  failed: ["handoff_required"],
  handoff_required: ["handoff_completed"],
  handoff_completed: [],
  expired: [],
};

export const TERMINAL_TASK_STATES: readonly TaskState[] = [
  "rejected",
  "succeeded",
  "handoff_completed",
  "expired",
];

export class InvalidTaskStateTransitionError extends Error {
  constructor(
    public readonly from: TaskState,
    public readonly to: TaskState,
  ) {
    super(`Invalid task state transition: ${from} -> ${to}`);
    this.name = "InvalidTaskStateTransitionError";
  }
}

export function getAllowedTransitions(state: TaskState): readonly TaskState[] {
  return TASK_STATE_TRANSITIONS[state];
}

export function canTransitionTaskState(
  from: TaskState,
  to: TaskState,
): boolean {
  return TASK_STATE_TRANSITIONS[from].includes(to);
}

export function assertTransitionTaskState(
  from: TaskState,
  to: TaskState,
): void {
  if (!canTransitionTaskState(from, to)) {
    throw new InvalidTaskStateTransitionError(from, to);
  }
}

export function transitionTaskState(from: TaskState, to: TaskState): TaskState {
  assertTransitionTaskState(from, to);
  return to;
}

export function isTerminalTaskState(state: TaskState): boolean {
  return TERMINAL_TASK_STATES.includes(state);
}

export function resolvePolicyDecisionState(
  decision: PolicyDecisionValue,
): Extract<TaskState, "approved" | "rejected" | "approval_required" | "handoff_required"> {
  switch (decision) {
    case "allow":
      return "approved";
    case "deny":
      return "rejected";
    case "approval_required":
      return "approval_required";
    case "handoff_required":
      return "handoff_required";
  }
}

export function resolveApprovalDecisionState(
  decision: ApprovalDecisionValue,
): Extract<TaskState, "approved" | "rejected" | "expired"> {
  switch (decision) {
    case "approved":
      return "approved";
    case "rejected":
      return "rejected";
    case "expired":
      return "expired";
  }
}

export function canExecuteTask(state: TaskState): state is "approved" {
  return state === "approved";
}
