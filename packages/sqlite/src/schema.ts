export const SQLITE_SCHEMA_VERSION = 1;

export const ACTION_REQUEST_STATE_CHECK = [
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
]
  .map((state) => `'${state}'`)
  .join(", ");

export const RISK_LEVEL_CHECK = ["low", "medium", "high"]
  .map((riskLevel) => `'${riskLevel}'`)
  .join(", ");

export const CREATE_SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS action_requests (
  task_id TEXT PRIMARY KEY,
  action_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  tool TEXT NOT NULL,
  operation TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  risk_level TEXT NOT NULL CHECK (risk_level IN (${RISK_LEVEL_CHECK})),
  expected_effect TEXT NOT NULL,
  payload TEXT NOT NULL,
  policy_context TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK (state IN (${ACTION_REQUEST_STATE_CHECK})),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_action_requests_state_created_at
  ON action_requests (state, created_at);

CREATE INDEX IF NOT EXISTS idx_action_requests_resource
  ON action_requests (resource_type, resource_id);

CREATE TABLE IF NOT EXISTS policy_decisions (
  policy_decision_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  policy_id TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  decision TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  evaluated_at TEXT NOT NULL,
  matched_rules TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES action_requests (task_id)
);

CREATE INDEX IF NOT EXISTS idx_policy_decisions_task_id_evaluated_at
  ON policy_decisions (task_id, evaluated_at);

CREATE TABLE IF NOT EXISTS approval_decisions (
  approval_decision_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  action_schema_hash TEXT NOT NULL,
  policy_id TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  approver_id TEXT NOT NULL,
  decision TEXT NOT NULL,
  decision_reason_code TEXT NOT NULL,
  prior_decision_id TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES action_requests (task_id)
);

CREATE INDEX IF NOT EXISTS idx_approval_decisions_task_id_created_at
  ON approval_decisions (task_id, created_at);

CREATE TABLE IF NOT EXISTS handoff_tickets (
  handoff_ticket_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  handoff_reason TEXT NOT NULL,
  required_context TEXT NOT NULL,
  assigned_to TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  closed_at TEXT,
  FOREIGN KEY (task_id) REFERENCES action_requests (task_id)
);

CREATE INDEX IF NOT EXISTS idx_handoff_tickets_status_created_at
  ON handoff_tickets (status, created_at);

CREATE TABLE IF NOT EXISTS audit_events (
  event_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN (${ACTION_REQUEST_STATE_CHECK})),
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  payload TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  correlation_id TEXT,
  idempotency_key TEXT,
  source TEXT,
  payload_hash TEXT NOT NULL,
  prev_event_hash TEXT,
  event_hash TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES action_requests (task_id)
);

CREATE INDEX IF NOT EXISTS idx_audit_events_task_id_timestamp
  ON audit_events (task_id, timestamp);

CREATE INDEX IF NOT EXISTS idx_audit_events_event_hash
  ON audit_events (event_hash);
`;
