import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  getCurrentUser,
  unauthorized,
  forbidden,
  notFound,
  badRequest,
  getProjectMembership,
} from "@/lib/auth";

type Params = { params: Promise<{ id: string }> };

const createCommentSchema = z.object({
  body: z
    .string()
    .min(1, "comment cannot be empty")
    .max(2000, "comment must be 2000 characters or fewer"),
});

/**
 * GET /api/tasks/:id/comments
 *
 * Returns all comments for a task in chronological order.
 * Requires auth + project membership (any role including viewer).
 */
export async function GET(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser(req);
  if (!user) return unauthorized();

  const { id: taskId } = await params;

  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) return notFound("task not found");

  const membership = await getProjectMembership(user.id, task.projectId);
  if (!membership) return forbidden("you are not a member of this project");

  const comments = await prisma.comment.findMany({
    where: { taskId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      taskId: true,
      body: true,
      createdAt: true,
      author: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json({ comments });
}

/**
 * POST /api/tasks/:id/comments
 *
 * Creates a new comment on a task.
 * Requires auth + project membership (any role — viewers can comment).
 * Body: { body: string } — min 1 char, max 2000 chars.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser(req);
  if (!user) return unauthorized();

  const { id: taskId } = await params;

  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) return notFound("task not found");

  const membership = await getProjectMembership(user.id, task.projectId);
  if (!membership) return forbidden("you are not a member of this project");

  const body = await req.json().catch(() => null);
  const parsed = createCommentSchema.safeParse(body);
  if (!parsed.success) return badRequest("invalid input", parsed.error.flatten());

  const comment = await prisma.comment.create({
    data: {
      taskId,
      authorId: user.id,
      body: parsed.data.body,
    },
    select: {
      id: true,
      taskId: true,
      body: true,
      createdAt: true,
      author: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json({ comment }, { status: 201 });
}
