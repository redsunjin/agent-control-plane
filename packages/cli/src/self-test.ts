import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createAuditEvent, type ActionRequest } from "@agent-control-plane/core";
import { SqliteAdapter } from "@agent-control-plane/sqlite";

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
    expectedEffect: "update local markdown record",
    payload: {
      patch: "replace summary line",
    },
    policyContext: {
      environment: "test",
    },
    idempotencyKey: `idem-${taskId}`,
    submittedAt: "2026-03-19T13:00:00.000Z",
  };
}

function testInspectAndAudit(): void {
  const tempDir = mkdtempSync(join(tmpdir(), "acp-cli-"));
  const dbFilename = join(tempDir, "acp.sqlite");
  const adapter = new SqliteAdapter({ filename: dbFilename });
  const request = buildRequest("task-cli-1");

  adapter.createActionRequest({
    request,
    state: "approval_required",
  });

  const requested = createAuditEvent({
    eventId: "evt-1",
    taskId: request.taskId,
    eventType: "action.requested",
    state: "received",
    actorType: "agent",
    actorId: request.actorId,
    occurredAt: "2026-03-19T13:00:00.000Z",
    payload: {
      actionId: request.actionId,
    },
  });

  const approvalRequested = createAuditEvent({
    eventId: "evt-2",
    taskId: request.taskId,
    eventType: "approval.requested",
    state: "approval_required",
    actorType: "system",
    actorId: "policy-engine",
    occurredAt: "2026-03-19T13:01:00.000Z",
    prevEventHash: requested.eventHash,
    payload: {
      reason: "high-risk",
    },
  });

  adapter.appendAuditEvent(requested);
  adapter.appendAuditEvent(approvalRequested);
  adapter.close();

  const inspect = spawnSync(
    process.execPath,
    ["dist/index.js", "inspect", request.taskId, "--db", dbFilename],
    {
      cwd: process.cwd(),
      encoding: "utf8",
    },
  );

  assert(inspect.status === 0, `inspect should succeed: ${inspect.stderr}`);
  assert(inspect.stdout.includes("state: approval_required"), "inspect should print current state");
  assert(inspect.stdout.includes("approval_status: pending"), "inspect should show pending approval");
  assert(inspect.stdout.includes("audit_event_count: 2"), "inspect should show audit count");

  const audit = spawnSync(
    process.execPath,
    ["dist/index.js", "audit", request.taskId, "--db", dbFilename],
    {
      cwd: process.cwd(),
      encoding: "utf8",
    },
  );

  assert(audit.status === 0, `audit should succeed: ${audit.stderr}`);
  assert(audit.stdout.includes("event_count: 2"), "audit should print event count");
  assert(audit.stdout.includes("event_type: approval.requested"), "audit should print stored events");

  const missing = spawnSync(
    process.execPath,
    ["dist/index.js", "inspect", "missing-task", "--db", dbFilename],
    {
      cwd: process.cwd(),
      encoding: "utf8",
    },
  );

  assert(missing.status === 2, "inspect should return 2 for missing task");

  const invalid = spawnSync(process.execPath, ["dist/index.js", "inspect"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert(invalid.status === 1, "inspect without task id should return 1");

  rmSync(tempDir, { recursive: true, force: true });
}

function testSubmitApproveRejectAndHandoff(): void {
  const tempDir = mkdtempSync(join(tmpdir(), "acp-cli-write-"));
  const dbFilename = join(tempDir, "acp.sqlite");

  const approvalRequestFile = join(tempDir, "approval-request.json");
  writeFileSync(
    approvalRequestFile,
    JSON.stringify({
      task_id: "task-write-1",
      action_id: "action-write-1",
      actor_id: "agent-1",
      tool: "local-file-tool",
      operation: "record_update",
      resource_type: "local_markdown",
      resource_id: "/tmp/task-write-1.md",
      risk_level: "high",
      expected_effect: "update local markdown record",
      payload: { patch: "replace summary" },
      policy_context: { environment: "test" },
      idempotency_key: "idem-write-1",
      submitted_at: "2026-03-19T13:10:00.000Z",
    }),
  );

  const submit = spawnSync(
    process.execPath,
    ["dist/index.js", "submit", approvalRequestFile, "--db", dbFilename],
    { cwd: process.cwd(), encoding: "utf8" },
  );

  assert(submit.status === 0, `submit should succeed: ${submit.stderr}`);
  assert(
    submit.stdout.includes("policy_decision: approval_required"),
    "submit should record approval_required decision",
  );

  const approve = spawnSync(
    process.execPath,
    [
      "dist/index.js",
      "approve",
      "task-write-1",
      "--approver",
      "alice",
      "--db",
      dbFilename,
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );

  assert(approve.status === 0, `approve should succeed: ${approve.stderr}`);
  assert(approve.stdout.includes("approval_decision: approved"), "approve should record approval");

  const execute = spawnSync(
    process.execPath,
    ["dist/index.js", "execute", "task-write-1", "--db", dbFilename],
    { cwd: process.cwd(), encoding: "utf8" },
  );

  assert(execute.status === 4, "execute should fail for missing local_markdown payload.content");

  const denyRequestFile = join(tempDir, "deny-request.yaml");
  writeFileSync(
    denyRequestFile,
    [
      "task_id: task-write-2",
      "action_id: action-write-2",
      "actor_id: agent-1",
      "tool: local-file-tool",
      "operation: record_update",
      "resource_type: remote_api",
      "resource_id: remote-1",
      "risk_level: low",
      "expected_effect: update remote record",
      "payload:",
      "  patch: replace summary",
      "policy_context:",
      "  environment: test",
      "idempotency_key: idem-write-2",
      "submitted_at: 2026-03-19T13:11:00.000Z",
    ].join("\n"),
  );

  const deniedSubmit = spawnSync(
    process.execPath,
    ["dist/index.js", "submit", denyRequestFile, "--db", dbFilename],
    { cwd: process.cwd(), encoding: "utf8" },
  );

  assert(deniedSubmit.status === 3, "policy denial should return exit code 3");

  const handoffRequestFile = join(tempDir, "handoff-request.json");
  writeFileSync(
    handoffRequestFile,
    JSON.stringify({
      task_id: "task-write-3",
      action_id: "action-write-3",
      actor_id: "agent-1",
      tool: "local-file-tool",
      operation: "record_update",
      resource_type: "local_markdown",
      resource_id: "/tmp/task-write-3.md",
      risk_level: "low",
      expected_effect: "update local markdown record",
      payload: { patch: "replace summary" },
      policy_context: { environment: "test" },
      idempotency_key: "idem-write-3",
      submitted_at: "2026-03-19T13:12:00.000Z",
      extra_field: "unexpected",
    }),
  );

  const handoffSubmit = spawnSync(
    process.execPath,
    ["dist/index.js", "submit", handoffRequestFile, "--db", dbFilename],
    { cwd: process.cwd(), encoding: "utf8" },
  );

  assert(
    handoffSubmit.stdout.includes("state: handoff_required"),
    "unknown fields should route the request to handoff_required",
  );

  const handoff = spawnSync(
    process.execPath,
    [
      "dist/index.js",
      "handoff",
      "task-write-3",
      "--to",
      "ops-queue",
      "--reason",
      "missing_context",
      "--db",
      dbFilename,
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );

  assert(handoff.status === 0, `handoff should succeed: ${handoff.stderr}`);
  assert(handoff.stdout.includes("assigned_to: ops-queue"), "handoff should create a ticket");

  const rejectRequestFile = join(tempDir, "reject-request.json");
  writeFileSync(
    rejectRequestFile,
    JSON.stringify({
      task_id: "task-write-4",
      action_id: "action-write-4",
      actor_id: "agent-1",
      tool: "local-file-tool",
      operation: "record_update",
      resource_type: "local_markdown",
      resource_id: "/tmp/task-write-4.md",
      risk_level: "high",
      expected_effect: "update local markdown record",
      payload: { patch: "replace summary" },
      policy_context: { environment: "test" },
      idempotency_key: "idem-write-4",
      submitted_at: "2026-03-19T13:13:00.000Z",
    }),
  );

  spawnSync(
    process.execPath,
    ["dist/index.js", "submit", rejectRequestFile, "--db", dbFilename],
    { cwd: process.cwd(), encoding: "utf8" },
  );

  const reject = spawnSync(
    process.execPath,
    [
      "dist/index.js",
      "reject",
      "task-write-4",
      "--approver",
      "alice",
      "--reason",
      "policy_violation",
      "--db",
      dbFilename,
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );

  assert(reject.status === 3, "reject should return exit code 3");

  const executeRequestFile = join(tempDir, "execute-request.json");
  const executeTargetFile = join(tempDir, "record.md");
  writeFileSync(
    executeRequestFile,
    JSON.stringify({
      task_id: "task-write-5",
      action_id: "action-write-5",
      actor_id: "agent-1",
      tool: "local-file-tool",
      operation: "record_update",
      resource_type: "local_markdown",
      resource_id: executeTargetFile,
      risk_level: "high",
      expected_effect: "write approved markdown content",
      payload: { content: "# Approved Record\n\nHello world.\n" },
      policy_context: { environment: "test" },
      idempotency_key: "idem-write-5",
      submitted_at: "2026-03-19T13:14:00.000Z",
    }),
  );

  spawnSync(
    process.execPath,
    ["dist/index.js", "submit", executeRequestFile, "--db", dbFilename],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  spawnSync(
    process.execPath,
    [
      "dist/index.js",
      "approve",
      "task-write-5",
      "--approver",
      "alice",
      "--db",
      dbFilename,
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );

  const executeSuccess = spawnSync(
    process.execPath,
    ["dist/index.js", "execute", "task-write-5", "--db", dbFilename],
    { cwd: process.cwd(), encoding: "utf8" },
  );

  assert(executeSuccess.status === 0, `execute should succeed: ${executeSuccess.stderr}`);
  assert(
    readFileSync(executeTargetFile, "utf8").includes("Approved Record"),
    "execute should update the local record file",
  );

  rmSync(tempDir, { recursive: true, force: true });
}

function run(): void {
  testInspectAndAudit();
  testSubmitApproveRejectAndHandoff();
  console.log("packages/cli self-test passed");
}

run();
