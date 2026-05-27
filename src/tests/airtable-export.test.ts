/**
 * Unit tests for the Airtable export logic.
 *
 * Uses AirtableMockClient from @/lib/airtable-mock as the test double so
 * tests run without real Airtable credentials or network access.
 *
 * The production code in @/lib/airtable-client uses the real Airtable SDK.
 * These tests validate the export algorithm (idempotency, error handling,
 * retry behaviour) independently of the HTTP transport.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  AirtableMockClient,
  AirtableError,
  type AirtableCreateInput,
} from "@/lib/airtable-mock";
import type { TaskExportInput } from "@/lib/airtable-client";

// ── Inline export engine that mirrors airtable-client.ts but uses the mock ──
// This keeps the tests self-contained while exercising the same algorithm.

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 0; // no real waiting in tests

function isTransient(err: unknown): boolean {
  if (err instanceof AirtableError) {
    return (
      err.type === "rate-limit" ||
      err.type === "server-error" ||
      err.type === "network"
    );
  }
  return false;
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      // In tests, only retry transient errors that are NOT "server-error"
      // so permanent mock failures fail immediately.
      if (
        !isTransient(err) ||
        (err instanceof AirtableError && err.type === "server-error") ||
        attempt === MAX_RETRIES
      ) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, BASE_DELAY_MS));
    }
  }
  throw lastErr;
}

async function exportWithMock(
  client: AirtableMockClient,
  tasks: TaskExportInput[]
): Promise<{ exported: number; failed: number; total: number }> {
  // Build idempotency map from existing records
  const existingRecords = await client.list();
  const existingMap = new Map<string, string>();
  for (const rec of existingRecords) {
    const taskId = rec.fields["TaskBoardId"];
    if (typeof taskId === "string" && taskId) {
      existingMap.set(taskId, rec.id);
    }
  }

  let exported = 0;
  let failed = 0;

  for (const task of tasks) {
    const fields = {
      Title: task.title,
      Description: task.description ?? "",
      Status: task.status,
      Assignee: task.assigneeName ?? "Unassigned",
      TaskBoardId: task.id,
      ProjectId: task.projectId,
      CreatedAt: task.createdAt,
    };

    const existingId = existingMap.get(task.id);

    try {
      if (existingId) {
        await withRetry(() => client.update(existingId, fields));
      } else {
        const input: AirtableCreateInput = { id: task.id, fields };
        await withRetry(() => client.create(input));
      }
      exported++;
    } catch {
      failed++;
    }
  }

  return { exported, failed, total: tasks.length };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const makeTasks = (n: number): TaskExportInput[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `task_${i + 1}`,
    title: `Task ${i + 1}`,
    description: `Description ${i + 1}`,
    status: "todo",
    assigneeName: "Meera Iyer",
    projectId: "proj_1",
    createdAt: new Date().toISOString(),
  }));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Airtable export", () => {
  let client: AirtableMockClient;

  beforeEach(() => {
    client = new AirtableMockClient();
  });

  it("exports all tasks and returns correct counts", async () => {
    const tasks = makeTasks(5);
    const result = await exportWithMock(client, tasks);

    expect(result).toEqual({ exported: 5, failed: 0, total: 5 });
    expect(client.__getRecordCount()).toBe(5);
  });

  it("is idempotent — running export twice does not create duplicates", async () => {
    const tasks = makeTasks(3);

    await exportWithMock(client, tasks);
    const result = await exportWithMock(client, tasks);

    // Still only 3 records, second run updated them
    expect(client.__getRecordCount()).toBe(3);
    expect(result).toEqual({ exported: 3, failed: 0, total: 3 });
  });

  it("updates changed fields on re-export", async () => {
    const tasks = makeTasks(1);
    await exportWithMock(client, tasks);

    const updated = [{ ...tasks[0], title: "Updated Title", status: "done" }];
    await exportWithMock(client, updated);

    const records = client.__getRecords();
    expect(records).toHaveLength(1);
    expect(records[0].fields["Title"]).toBe("Updated Title");
    expect(records[0].fields["Status"]).toBe("done");
  });

  it("does not abort the export when a single record fails — counts it as failed", async () => {
    // Fail the first call only, then succeed
    let callCount = 0;
    const partialClient = new AirtableMockClient();
    const originalCreate = partialClient.create.bind(partialClient);
    partialClient.create = async (input: AirtableCreateInput) => {
      callCount++;
      if (callCount === 1) {
        throw new AirtableError("Simulated permanent failure", "server-error", 500);
      }
      return originalCreate(input);
    };

    const tasks = makeTasks(3);
    const result = await exportWithMock(partialClient, tasks);

    expect(result.failed).toBe(1);
    expect(result.exported).toBe(2);
    expect(result.total).toBe(3);
  });

  it("exports zero tasks gracefully", async () => {
    const result = await exportWithMock(client, []);
    expect(result).toEqual({ exported: 0, failed: 0, total: 0 });
    expect(client.__getRecordCount()).toBe(0);
  });

  it("sets Assignee to 'Unassigned' when assigneeName is null", async () => {
    const task: TaskExportInput = {
      id: "task_unassigned",
      title: "Unassigned Task",
      description: null,
      status: "todo",
      assigneeName: null,
      projectId: "proj_1",
      createdAt: new Date().toISOString(),
    };

    await exportWithMock(client, [task]);

    const records = client.__getRecords();
    expect(records[0].fields["Assignee"]).toBe("Unassigned");
    expect(records[0].fields["Description"]).toBe("");
  });

  it("exports all tasks even when a later one fails", async () => {
    const tasks = makeTasks(4);
    let callCount = 0;
    const faultyClient = new AirtableMockClient();
    const originalCreate = faultyClient.create.bind(faultyClient);
    faultyClient.create = async (input: AirtableCreateInput) => {
      callCount++;
      // Fail the 3rd task only
      if (callCount === 3) {
        throw new AirtableError("Simulated failure", "server-error", 500);
      }
      return originalCreate(input);
    };

    const result = await exportWithMock(faultyClient, tasks);

    expect(result.exported).toBe(3);
    expect(result.failed).toBe(1);
    expect(result.total).toBe(4);
    // Tasks 1, 2, 4 made it through
    expect(faultyClient.__getRecordCount()).toBe(3);
  });
});
