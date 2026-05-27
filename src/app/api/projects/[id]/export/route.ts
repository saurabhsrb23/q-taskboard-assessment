import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getCurrentUser,
  unauthorized,
  forbidden,
  getProjectMembership,
  canEditTasks,
} from "@/lib/auth";
import { exportTasksToAirtable } from "@/lib/airtable-client";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/projects/:id/export
 *
 * Exports all tasks in the project to the configured Airtable base.
 * Only admin and member roles can trigger an export — viewers are blocked.
 *
 * The export is idempotent: running it more than once updates existing
 * Airtable records rather than creating duplicates.
 *
 * Returns: { exported, failed, total }
 *
 * Errors:
 *   401 — not authenticated
 *   403 — not a project member, or viewer role
 *   503 — Airtable env vars (AIRTABLE_API_KEY, AIRTABLE_BASE_ID) not set
 *   500 — unexpected failure during export
 */
export async function POST(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser(req);
  if (!user) return unauthorized();

  const { id: projectId } = await params;

  const membership = await getProjectMembership(user.id, projectId);
  if (!membership) return forbidden("you are not a member of this project");
  if (!canEditTasks(membership.role)) {
    return forbidden("viewers cannot export tasks");
  }

  // Guard: ensure Airtable is configured before touching the DB
  if (!process.env.AIRTABLE_API_KEY || !process.env.AIRTABLE_BASE_ID) {
    return NextResponse.json(
      { error: "Airtable is not configured on this server" },
      { status: 503 }
    );
  }

  // Fetch all tasks for this project with assignee name
  const tasks = await prisma.task.findMany({
    where: { projectId },
    include: { assignee: { select: { name: true } } },
    orderBy: { position: "asc" },
  });

  try {
    const result = await exportTasksToAirtable(
      tasks.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        status: t.status,
        assigneeName: t.assignee?.name ?? null,
        projectId: t.projectId,
        createdAt: t.createdAt.toISOString(),
      }))
    );

    return NextResponse.json(result);
  } catch (err) {
    console.error("[export] Airtable export failed:", err);
    return NextResponse.json(
      { error: "Export failed. Check server logs for details." },
      { status: 500 }
    );
  }
}
