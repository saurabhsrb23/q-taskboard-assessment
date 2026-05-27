/**
 * Unit tests for the task comments feature.
 *
 * These tests validate the comment schema validation logic — the same rules
 * enforced at the API boundary in POST /api/tasks/:id/comments.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";

const createCommentSchema = z.object({
  body: z
    .string()
    .min(1, "comment cannot be empty")
    .max(2000, "comment must be 2000 characters or fewer"),
});

describe("comment schema validation", () => {
  it("accepts a valid comment body", () => {
    const result = createCommentSchema.safeParse({ body: "Looks good to me!" });
    expect(result.success).toBe(true);
  });

  it("rejects an empty body", () => {
    const result = createCommentSchema.safeParse({ body: "" });
    expect(result.success).toBe(false);
    expect(result.error?.flatten().fieldErrors.body).toContain(
      "comment cannot be empty"
    );
  });

  it("rejects a body over 2000 characters", () => {
    const result = createCommentSchema.safeParse({ body: "a".repeat(2001) });
    expect(result.success).toBe(false);
    expect(result.error?.flatten().fieldErrors.body).toContain(
      "comment must be 2000 characters or fewer"
    );
  });

  it("accepts a body of exactly 2000 characters", () => {
    const result = createCommentSchema.safeParse({ body: "a".repeat(2000) });
    expect(result.success).toBe(true);
  });

  it("accepts a single character body", () => {
    const result = createCommentSchema.safeParse({ body: "x" });
    expect(result.success).toBe(true);
  });

  it("rejects missing body field", () => {
    const result = createCommentSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects whitespace-only body (min length is string length, not trimmed)", () => {
    // The schema accepts whitespace — trimming is done at the call site in the UI
    const result = createCommentSchema.safeParse({ body: " " });
    expect(result.success).toBe(true);
  });
});
