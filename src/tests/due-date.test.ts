/**
 * Unit tests for the task due date feature.
 *
 * Tests cover:
 * 1. Schema validation — dueDate field on updateTaskSchema
 * 2. getDueDateState helper logic — overdue / today / upcoming
 */

import { describe, it, expect } from "vitest";
import { updateTaskSchema } from "@/schemas/task";

// ── Inline getDueDateState — mirrors the logic in TaskCard.tsx ───────────────

function getDueDateState(dueDate: string): "overdue" | "today" | "upcoming" {
  const due = new Date(dueDate);
  const today = new Date();
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const todayDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (dueDay < todayDay) return "overdue";
  if (dueDay.getTime() === todayDay.getTime()) return "today";
  return "upcoming";
}

// ── Schema validation tests ───────────────────────────────────────────────────

describe("updateTaskSchema — dueDate field", () => {
  it("accepts a valid ISO datetime string", () => {
    const result = updateTaskSchema.safeParse({
      dueDate: "2030-12-31T00:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("accepts null to clear a due date", () => {
    const result = updateTaskSchema.safeParse({ dueDate: null });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.dueDate).toBeNull();
  });

  it("accepts undefined (field omitted — no change)", () => {
    const result = updateTaskSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.dueDate).toBeUndefined();
  });

  it("rejects a plain date string without time component", () => {
    const result = updateTaskSchema.safeParse({ dueDate: "2030-12-31" });
    expect(result.success).toBe(false);
  });

  it("rejects a random non-date string", () => {
    const result = updateTaskSchema.safeParse({ dueDate: "not-a-date" });
    expect(result.success).toBe(false);
  });
});

// ── getDueDateState logic tests ───────────────────────────────────────────────

describe("getDueDateState", () => {
  it("returns 'overdue' for a past date", () => {
    const pastDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    expect(getDueDateState(pastDate)).toBe("overdue");
  });

  it("returns 'today' for today's date", () => {
    const today = new Date();
    // Midnight UTC of today
    const todayISO = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate()
    ).toISOString();
    expect(getDueDateState(todayISO)).toBe("today");
  });

  it("returns 'upcoming' for a future date", () => {
    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    expect(getDueDateState(futureDate)).toBe("upcoming");
  });

  it("returns 'overdue' for yesterday", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    expect(getDueDateState(yesterday.toISOString())).toBe("overdue");
  });

  it("returns 'upcoming' for tomorrow", () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    expect(getDueDateState(tomorrow.toISOString())).toBe("upcoming");
  });
});
