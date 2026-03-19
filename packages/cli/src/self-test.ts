import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
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

function run(): void {
  testInspectAndAudit();
  console.log("packages/cli self-test passed");
}

run();
