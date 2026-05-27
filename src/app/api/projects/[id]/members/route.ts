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
  canEditProject,
} from "@/lib/auth";

type Params = { params: Promise<{ id: string }> };

const inviteMemberSchema = z.object({
  email: z.string().email("must be a valid email address"),
  role: z.enum(["admin", "member", "viewer"]),
});

const removeMemberSchema = z.object({
  userId: z.string().min(1),
});

/**
 * POST /api/projects/:id/members
 *
 * Invites an existing user (by email) to the project with a chosen role.
 * Only project admins can invite members.
 * The invited user must already have a TaskBoard account.
 * Returns 409 if the user is already a member.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser(req);
  if (!user) return unauthorized();

  const { id: projectId } = await params;

  const membership = await getProjectMembership(user.id, projectId);
  if (!membership) return forbidden("you are not a member of this project");
  if (!canEditProject(membership.role)) {
    return forbidden("only project admins can invite members");
  }

  const body = await req.json().catch(() => null);
  const parsed = inviteMemberSchema.safeParse(body);
  if (!parsed.success) return badRequest("invalid input", parsed.error.flatten());

  const { email, role } = parsed.data;

  // Find the user to invite by email
  const invitee = await prisma.user.findFirst({
    where: { email },
    select: { id: true, name: true, email: true },
  });
  if (!invitee) {
    return notFound("no account found with that email address");
  }

  // Check if already a member
  const existing = await getProjectMembership(invitee.id, projectId);
  if (existing) {
    return NextResponse.json(
      { error: "that user is already a member of this project" },
      { status: 409 }
    );
  }

  const newMembership = await prisma.membership.create({
    data: { userId: invitee.id, projectId, role },
    select: {
      id: true,
      role: true,
      user: { select: { id: true, name: true, email: true } },
    },
  });

  return NextResponse.json({ membership: newMembership }, { status: 201 });
}

/**
 * DELETE /api/projects/:id/members
 *
 * Removes a member from the project.
 * Only project admins can remove members.
 * Cannot remove the project owner or yourself.
 */
export async function DELETE(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser(req);
  if (!user) return unauthorized();

  const { id: projectId } = await params;

  const membership = await getProjectMembership(user.id, projectId);
  if (!membership) return forbidden("you are not a member of this project");
  if (!canEditProject(membership.role)) {
    return forbidden("only project admins can remove members");
  }

  const body = await req.json().catch(() => null);
  const parsed = removeMemberSchema.safeParse(body);
  if (!parsed.success) return badRequest("invalid input", parsed.error.flatten());

  const { userId } = parsed.data;

  // Prevent self-removal — admin would lock themselves out
  if (userId === user.id) {
    return badRequest("you cannot remove yourself from the project");
  }

  // Prevent removing the project owner
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { ownerId: true },
  });
  if (project?.ownerId === userId) {
    return badRequest("cannot remove the project owner");
  }

  const target = await getProjectMembership(userId, projectId);
  if (!target) return notFound("that user is not a member of this project");

  await prisma.membership.deleteMany({
    where: { userId, projectId },
  });

  return NextResponse.json({ ok: true });
}
