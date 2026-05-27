/**
 * Real Airtable client for exporting tasks to an Airtable base.
 *
 * Uses the official `airtable` npm package and reads credentials from env vars:
 *   AIRTABLE_API_KEY      — personal access token from airtable.com/account
 *   AIRTABLE_BASE_ID      — found in the Airtable API docs for your base (starts with "app")
 *   AIRTABLE_TABLE_NAME   — name of the table (default: "Tasks")
 *
 * Required Airtable table fields (create these before running an export):
 *   Title       — Single line text
 *   Description — Long text
 *   Status      — Single line text
 *   Assignee    — Single line text
 *   TaskBoardId — Single line text  ← idempotency key (task's internal ID)
 *   ProjectId   — Single line text
 *   CreatedAt   — Single line text
 *
 * For unit tests, use AirtableMockClient from @/lib/airtable-mock instead of this module.
 */

import Airtable from "airtable";

// ── Field name constants ─────────────────────────────────────────────────────

const F = {
  TITLE: "Title",
  DESCRIPTION: "Description",
  STATUS: "Status",
  ASSIGNEE: "Assignee",
  TASKBOARD_ID: "TaskBoardId",
  PROJECT_ID: "ProjectId",
  CREATED_AT: "CreatedAt",
} as const;

// ── Public types ─────────────────────────────────────────────────────────────

export type TaskExportInput = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  assigneeName: string | null;
  projectId: string;
  createdAt: string;
};

export type ExportResult = {
  exported: number;
  failed: number;
  total: number;
};

// ── Retry logic ──────────────────────────────────────────────────────────────

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

/**
 * Returns true for errors that are worth retrying:
 * 429 rate-limit, 5xx server errors, and network errors (no statusCode).
 * 4xx client errors (except 429) are permanent — retrying will not help.
 */
function isTransient(err: unknown): boolean {
  const status =
    (err as Record<string, unknown>)?.statusCode ??
    (err as Record<string, unknown>)?.status;
  if (status === undefined || status === null) return true; // network error
  const code = Number(status);
  return code === 429 || (code >= 500 && code < 600);
}

/**
 * Wraps an async function with exponential-backoff retry.
 * Retries only transient failures; re-throws permanent ones immediately.
 */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isTransient(err) || attempt === MAX_RETRIES) throw err;
      // Exponential backoff: 1 s, 2 s, 4 s
      await new Promise((r) => setTimeout(r, BASE_DELAY_MS * Math.pow(2, attempt)));
    }
  }
  throw lastErr;
}

// ── Main export function ─────────────────────────────────────────────────────

/**
 * Exports an array of tasks to the configured Airtable base.
 *
 * Idempotent: runs the export multiple times without creating duplicates.
 * Fetches all existing records first, then updates existing ones and creates
 * new ones based on the TaskBoardId field.
 *
 * Per-record errors do not abort the whole export — each failure is counted
 * and the remaining tasks continue to be processed.
 *
 * Throws if AIRTABLE_API_KEY or AIRTABLE_BASE_ID env vars are missing.
 */
export async function exportTasksToAirtable(
  tasks: TaskExportInput[]
): Promise<ExportResult> {
  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;
  const tableName = process.env.AIRTABLE_TABLE_NAME || "Tasks";

  if (!apiKey || !baseId) {
    throw new Error("AIRTABLE_API_KEY and AIRTABLE_BASE_ID must be set");
  }

  const table = new Airtable({ apiKey }).base(baseId)(tableName);

  // ── Step 1: Build idempotency map (TaskBoardId → Airtable record id) ──────
  // Fetches all pages automatically so we handle tables > 100 records.
  const existingMap = new Map<string, string>();

  const existingRecords = await withRetry(() =>
    table
      .select({ fields: [F.TASKBOARD_ID] })
      .all()
  );

  for (const rec of existingRecords) {
    const taskId = rec.get(F.TASKBOARD_ID);
    if (typeof taskId === "string" && taskId) {
      existingMap.set(taskId, rec.id);
    }
  }

  // ── Step 2: Upsert each task ──────────────────────────────────────────────
  let exported = 0;
  let failed = 0;

  for (const task of tasks) {
    const fields = {
      [F.TITLE]: task.title,
      [F.DESCRIPTION]: task.description ?? "",
      [F.STATUS]: task.status,
      [F.ASSIGNEE]: task.assigneeName ?? "Unassigned",
      [F.TASKBOARD_ID]: task.id,
      [F.PROJECT_ID]: task.projectId,
      [F.CREATED_AT]: task.createdAt,
    };

    const existingAirtableId = existingMap.get(task.id);

    try {
      if (existingAirtableId) {
        // Record already in Airtable — update it in place
        await withRetry(() => table.update(existingAirtableId, fields));
      } else {
        // New record — create it
        await withRetry(() => table.create(fields));
      }
      exported++;
    } catch (err) {
      // Permanent failure for this record — log and continue with the rest
      console.error(
        `[airtable-export] Failed to export task ${task.id} ("${task.title}"):`,
        err
      );
      failed++;
    }
  }

  return { exported, failed, total: tasks.length };
}
