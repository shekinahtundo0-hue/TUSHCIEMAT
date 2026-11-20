import { createHash, randomBytes } from "node:crypto";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { SchoolCapability } from "@workspace/api-zod";
import {
  guardiansTable,
  invitationsTable,
  schoolMembershipsTable,
  studentsTable,
  type SchoolRole,
} from "@workspace/db/schema";
import type { Database, Tx } from "../../lib/database";
import { audit, type SchoolContext } from "../../lib/context";
import { badRequest, conflict, forbidden, notFound } from "../../lib/errors";

export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

const memberColumns = {
  membershipId: schoolMembershipsTable.id,
  authUserId: schoolMembershipsTable.authUserId,
  fullName: sql<string | null>`school_people.full_name`,
  email: sql<string | null>`school_people.email`,
  role: schoolMembershipsTable.role,
  status: schoolMembershipsTable.status,
  createdAt: schoolMembershipsTable.createdAt,
  // RLS limits visibility to owners and the member themselves; other callers
  // legitimately see an empty list.
  capabilities: sql<SchoolCapability[]>`coalesce((
    select array_agg(mc.capability::text order by mc.capability::text)
    from membership_capabilities mc
    where mc.membership_id = ${schoolMembershipsTable.id}
  ), array[]::text[])`,
};

export function listMembers(tx: Tx, ctx: SchoolContext) {
  return tx
    .select(memberColumns)
    .from(schoolMembershipsTable)
    .leftJoin(sql`app_private.school_people(${ctx.schoolId}::uuid) as school_people`, sql`school_people.auth_user_id = ${schoolMembershipsTable.authUserId}`)
    .where(eq(schoolMembershipsTable.schoolId, ctx.schoolId))
    .orderBy(asc(schoolMembershipsTable.role), asc(sql`school_people.full_name`), asc(schoolMembershipsTable.createdAt));
}

async function getMember(tx: Tx, ctx: SchoolContext, membershipId: string) {
  const [member] = await tx
    .select(memberColumns)
    .from(schoolMembershipsTable)
    .leftJoin(sql`app_private.school_people(${ctx.schoolId}::uuid) as school_people`, sql`school_people.auth_user_id = ${schoolMembershipsTable.authUserId}`)
    .where(and(eq(schoolMembershipsTable.id, membershipId), eq(schoolMembershipsTable.schoolId, ctx.schoolId)));
  if (!member) throw notFound("Member not found.");
  return member;
}

export async function updateMember(
  tx: Tx,
  ctx: SchoolContext,
  membershipId: string,
  input: { status: "active" | "suspended" },
) {
  const [existing] = await tx
    .select({ authUserId: schoolMembershipsTable.authUserId, status: schoolMembershipsTable.status })
    .from(schoolMembershipsTable)
    .where(and(eq(schoolMembershipsTable.id, membershipId), eq(schoolMembershipsTable.schoolId, ctx.schoolId)));
  if (!existing) throw notFound("Member not found.");
  if (existing.authUserId === ctx.userId) throw forbidden("You cannot change your own access.");

  if (existing.status !== input.status) {
    await tx
      .update(schoolMembershipsTable)
      .set({ status: input.status })
      .where(and(eq(schoolMembershipsTable.id, membershipId), eq(schoolMembershipsTable.schoolId, ctx.schoolId)));
    await audit(tx, ctx, input.status === "suspended" ? "member.suspended" : "member.reactivated", "membership", membershipId);
  }

  return getMember(tx, ctx, membershipId);
}

export async function setMemberCapabilities(
  tx: Tx,
  ctx: SchoolContext,
  membershipId: string,
  capabilities: SchoolCapability[],
) {
  const [existing] = await tx
    .select({ id: schoolMembershipsTable.id })
    .from(schoolMembershipsTable)
    .where(and(eq(schoolMembershipsTable.id, membershipId), eq(schoolMembershipsTable.schoolId, ctx.schoolId)));
  if (!existing) throw notFound("Member not found.");
  // Bind each value separately; the explicit cast also types an empty ARRAY[].
  const capabilityArray = sql`ARRAY[${sql.join(capabilities.map((capability) => sql`${capability}`), sql`, `)}]::text[]`;
  // Owner-only, same-school school_admin target, atomic audited replacement:
  // all enforced inside the database routine and its triggers.
  await tx.execute(
    sql`select app_private.set_member_capabilities(${ctx.schoolId}::uuid, ${membershipId}::uuid, ${capabilityArray})`,
  );
  return getMember(tx, ctx, membershipId);
}

const invitationColumns = {
  id: invitationsTable.id,
  email: invitationsTable.email,
  role: invitationsTable.role,
  status: sql<"pending" | "accepted" | "revoked" | "expired">`case
    when ${invitationsTable.status} = 'pending' and ${invitationsTable.expiresAt} <= now() then 'expired'
    else ${invitationsTable.status}::text end`,
  expiresAt: invitationsTable.expiresAt,
  createdAt: invitationsTable.createdAt,
  studentFirstName: studentsTable.firstName,
  studentLastName: studentsTable.lastName,
  guardianName: guardiansTable.fullName,
};

type InvitationRow = {
  id: string;
  email: string;
  role: SchoolRole;
  status: "pending" | "accepted" | "revoked" | "expired";
  expiresAt: Date;
  createdAt: Date;
  studentFirstName: string | null;
  studentLastName: string | null;
  guardianName: string | null;
};

function toInvitation(row: InvitationRow) {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    status: row.status,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    studentName: row.studentFirstName ? `${row.studentFirstName} ${row.studentLastName}` : null,
    guardianName: row.guardianName,
  };
}

function selectInvitations(tx: Tx, ctx: SchoolContext) {
  return tx
    .select(invitationColumns)
    .from(invitationsTable)
    .leftJoin(
      studentsTable,
      and(eq(studentsTable.id, invitationsTable.studentId), eq(studentsTable.schoolId, ctx.schoolId)),
    )
    .leftJoin(
      guardiansTable,
      and(eq(guardiansTable.id, invitationsTable.guardianId), eq(guardiansTable.schoolId, ctx.schoolId)),
    );
}

export async function listInvitations(tx: Tx, ctx: SchoolContext) {
  const rows = await selectInvitations(tx, ctx)
    .where(eq(invitationsTable.schoolId, ctx.schoolId))
    .orderBy(desc(invitationsTable.createdAt))
    .limit(500);
  return rows.map(toInvitation);
}

async function getInvitation(tx: Tx, ctx: SchoolContext, invitationId: string) {
  const [row] = await selectInvitations(tx, ctx).where(
    and(eq(invitationsTable.id, invitationId), eq(invitationsTable.schoolId, ctx.schoolId)),
  );
  if (!row) throw notFound("Invitation not found.");
  return toInvitation(row);
}

export async function createInvitation(
  tx: Tx,
  ctx: SchoolContext,
  input: { email: string; role: SchoolRole; studentId?: string | null; guardianId?: string | null },
  ttlDays: number,
) {
  const email = input.email.trim().toLowerCase();
  const studentId = input.role === "student" ? (input.studentId ?? null) : null;
  const guardianId = input.role === "parent" ? (input.guardianId ?? null) : null;
  if (input.role === "student" && !studentId) {
    throw badRequest("Choose the student record this learner account is for.", "validation_failed");
  }
  if (input.role === "parent" && !guardianId) {
    throw badRequest("Choose the guardian record this parent account is for.", "validation_failed");
  }
  if (input.role === "owner" && !ctx.roles.includes("owner")) {
    throw forbidden("Only an owner can invite another owner.");
  }

  if (studentId) {
    const [student] = await tx
      .select({ authUserId: studentsTable.authUserId })
      .from(studentsTable)
      .where(and(eq(studentsTable.id, studentId), eq(studentsTable.schoolId, ctx.schoolId)));
    if (!student) throw notFound("Student not found.");
    if (student.authUserId) throw conflict("This student already has an account.");
  }
  if (guardianId) {
    const [guardian] = await tx
      .select({ authUserId: guardiansTable.authUserId, email: guardiansTable.email })
      .from(guardiansTable)
      .where(and(eq(guardiansTable.id, guardianId), eq(guardiansTable.schoolId, ctx.schoolId)));
    if (!guardian) throw notFound("Guardian not found.");
    if (guardian.authUserId) throw conflict("This guardian already has an account.");
    if (guardian.email && guardian.email !== email) {
      throw badRequest("The invitation must go to the email address on this guardian's record.", "validation_failed");
    }
  }

  const [pending] = await tx
    .select({ id: invitationsTable.id })
    .from(invitationsTable)
    .where(
      and(
        eq(invitationsTable.schoolId, ctx.schoolId),
        eq(invitationsTable.email, email),
        eq(invitationsTable.role, input.role),
        eq(invitationsTable.status, "pending"),
      ),
    );
  if (pending) throw conflict("A pending invitation already exists for this email and role. Revoke it first.");

  const token = randomBytes(32).toString("base64url");
  const [created] = await tx
    .insert(invitationsTable)
    .values({
      schoolId: ctx.schoolId,
      email,
      role: input.role,
      tokenHash: hashInvitationToken(token),
      studentId,
      guardianId,
      invitedByUserId: ctx.userId,
      expiresAt: new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000),
    })
    .returning({ id: invitationsTable.id });
  if (!created) throw new Error("invitation insert returned no row");

  await audit(tx, ctx, "invitation.created", "invitation", created.id, { role: input.role });
  return {
    invitation: await getInvitation(tx, ctx, created.id),
    // A URL fragment never reaches servers or access logs.
    acceptPath: `/accept-invite#${token}`,
  };
}

export async function revokeInvitation(tx: Tx, ctx: SchoolContext, invitationId: string) {
  const [existing] = await tx
    .select({ status: invitationsTable.status })
    .from(invitationsTable)
    .where(and(eq(invitationsTable.id, invitationId), eq(invitationsTable.schoolId, ctx.schoolId)));
  if (!existing) throw notFound("Invitation not found.");
  if (existing.status !== "pending") throw conflict("Only pending invitations can be revoked.");

  await tx
    .update(invitationsTable)
    .set({ status: "revoked" })
    .where(and(eq(invitationsTable.id, invitationId), eq(invitationsTable.schoolId, ctx.schoolId)));
  await audit(tx, ctx, "invitation.revoked", "invitation", invitationId);
  return getInvitation(tx, ctx, invitationId);
}

export async function acceptInvitation(database: Database, authUserId: string, token: string) {
  const rows = await database.asUser(authUserId, (tx) =>
    tx.execute<{ membership_id: string; school_id: string; role: SchoolRole }>(
      sql`select membership_id, school_id, role from app_private.accept_invitation(${hashInvitationToken(token)})`,
    ),
  );
  const [row] = rows.rows;
  if (!row) throw notFound("Invitation not found.");
  return { schoolId: row.school_id, role: row.role };
}
