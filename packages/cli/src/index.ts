#!/usr/bin/env node

import { SqliteAdapter } from "@agent-control-plane/sqlite";

const EXIT_SUCCESS = 0;
const EXIT_INVALID_INPUT = 1;
const EXIT_NOT_FOUND = 2;
const EXIT_INTERNAL_ERROR = 4;

type CliCommand = "inspect" | "audit" | "help";

interface ParsedArgs {
  command: CliCommand;
  taskId?: string;
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
      case "audit":
        return runAudit(parsed);
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

  if (command !== "inspect" && command !== "audit") {
    throw new Error(`Unknown command: ${command}`);
  }

  let taskId: string | undefined;
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
      throw new Error(`Unknown option: ${token}`);
    }

    if (taskId !== undefined) {
      throw new Error(`Unexpected extra argument: ${token}`);
    }

    taskId = token;
  }

  if (taskId === undefined) {
    throw new Error(`${command} requires a task id`);
  }

  return {
    command,
    taskId,
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

    console.log(`task_id: ${request.taskId}`);
    console.log(`state: ${request.state}`);
    console.log(`action_id: ${request.actionId}`);
    console.log(`resource: ${request.resourceType}:${request.resourceId}`);
    console.log(`risk_level: ${request.riskLevel}`);
    console.log(`submitted_at: ${request.submittedAt}`);
    console.log(`updated_at: ${request.updatedAt}`);
    console.log(`latest_policy_decision: not_recorded`);
    console.log(`approval_status: ${deriveApprovalStatus(request.state)}`);
    console.log(`execution_status: ${deriveExecutionStatus(request.state)}`);
    console.log(`handoff_status: ${deriveHandoffStatus(request.state)}`);
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
    case "handoff_required":
    case "handoff_completed":
      return "approved";
    case "rejected":
      return "rejected";
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
    case "handoff_required":
    case "handoff_completed":
      return "failed_or_handoff";
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
  console.log("  acp inspect <task-id> [--db <filename>]");
  console.log("  acp audit <task-id> [--db <filename>]");
  console.log("");
  console.log("Environment:");
  console.log("  ACP_DB_FILE  Default SQLite filename");
}

process.exitCode = main(process.argv.slice(2));
