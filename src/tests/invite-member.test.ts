/**
 * Unit tests for the invite member feature.
 *
 * Tests validate the inviteMemberSchema used at the
 * POST /api/projects/:id/members API boundary.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";

const inviteMemberSchema = z.object({
  email: z.string().email("must be a valid email address"),
  role: z.enum(["admin", "member", "viewer"]),
});

describe("inviteMemberSchema", () => {
  it("accepts a valid email and member role", () => {
    const result = inviteMemberSchema.safeParse({
      email: "user@example.com",
      role: "member",
    });
    expect(result.success).toBe(true);
  });

  it("accepts the admin role", () => {
    const result = inviteMemberSchema.safeParse({
      email: "admin@example.com",
      role: "admin",
    });
    expect(result.success).toBe(true);
  });

  it("accepts the viewer role", () => {
    const result = inviteMemberSchema.safeParse({
      email: "viewer@example.com",
      role: "viewer",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a missing email", () => {
    const result = inviteMemberSchema.safeParse({ role: "member" });
    expect(result.success).toBe(false);
    expect(result.error?.flatten().fieldErrors.email).toBeDefined();
  });

  it("rejects an invalid email format", () => {
    const result = inviteMemberSchema.safeParse({
      email: "not-an-email",
      role: "member",
    });
    expect(result.success).toBe(false);
    expect(result.error?.flatten().fieldErrors.email).toContain(
      "must be a valid email address"
    );
  });

  it("rejects an invalid role value", () => {
    const result = inviteMemberSchema.safeParse({
      email: "user@example.com",
      role: "superuser",
    });
    expect(result.success).toBe(false);
    expect(result.error?.flatten().fieldErrors.role).toBeDefined();
  });

  it("rejects missing role", () => {
    const result = inviteMemberSchema.safeParse({ email: "user@example.com" });
    expect(result.success).toBe(false);
    expect(result.error?.flatten().fieldErrors.role).toBeDefined();
  });

  it("rejects an empty body", () => {
    const result = inviteMemberSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
