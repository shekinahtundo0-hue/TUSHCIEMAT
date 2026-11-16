import { and, desc, eq, sql } from "drizzle-orm";
import type { JoinRequestInput, JoinRequestReview } from "@workspace/api-zod";
import {
  announcementsTable,
  notificationsTable,
  schoolJoinRequestsTable,
} from "@workspace/db/schema";
import type { Tx } from "../../lib/database";
import type { SchoolContext } from "../../lib/context";
import { badRequest, notFound } from "../../lib/errors";
import { hashInvitationToken } from "./service";

type DirectoryRow = {
  id: string;
  name: string;
  category: string;
  country: string;
  county: string | null;
  town: string | null;
  logo_url: string | null;
  description: string | null;
  verification_status: string;
};

export async function discoverSchools(tx: Tx, search: string, page: number, schoolId: string | null = null) {
  const rows = await tx.execute<DirectoryRow>(
    sql`select * from app_private.school_directory(${search}, ${schoolId}::uuid, ${(page - 1) * 20})`,
  );
  return rows.rows.map((row) => ({
    id: row.id,
    name: row.name,
    category: row.category,
    country: row.country,
    county: row.county,
    town: row.town,
    logoUrl: row.logo_url,
    description: row.description,
    verificationStatus: row.verification_status,
  }));
}

export async function getDiscoverableSchool(tx: Tx, schoolId: string) {
  const [school] = await discoverSchools(tx, "", 1, schoolId);
  if (!school) throw notFound("This school is not listed. Ask the school for an invitation, or search again.");
  return school;
}

async function getRequest(tx: Tx, schoolId: string, requestId: string) {
  const [request] = await tx.select().from(schoolJoinRequestsTable).where(
    and(eq(schoolJoinRequestsTable.schoolId, schoolId), eq(schoolJoinRequestsTable.id, requestId)),
  );
  if (!request) throw notFound("Membership request not found.");
  return request;
}

export async function submitJoinRequest(tx: Tx, schoolId: string, input: JoinRequestInput) {
  const { requestedRole, ...fields } = input;
  const details = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value.trim()]));
  if (details.fullName!.length < 2) throw badRequest("Enter your full name.", "validation_failed");
  if (requestedRole === "student" && !details.admissionNumber) {
    throw badRequest("Enter your school admission number so the administrator can review your request.", "validation_failed");
  }
  const result = await tx.execute<{ id: string }>(sql`
    select id from app_private.submit_join_request(${schoolId}::uuid, ${requestedRole}::public.school_role, ${JSON.stringify(details)}::jsonb)
  `);
  const row = result.rows[0];
  if (!row) throw notFound("Membership request not found.");
  return getRequest(tx, schoolId, row.id);
}

export function listMyJoinRequests(tx: Tx, userId: string) {
  return tx.select().from(schoolJoinRequestsTable)
    .where(eq(schoolJoinRequestsTable.authUserId, userId))
    .orderBy(desc(schoolJoinRequestsTable.submittedAt)).limit(100);
}

export function listJoinRequests(tx: Tx, ctx: SchoolContext) {
  return tx.select().from(schoolJoinRequestsTable)
    .where(eq(schoolJoinRequestsTable.schoolId, ctx.schoolId))
    .orderBy(desc(schoolJoinRequestsTable.submittedAt)).limit(500);
}

export async function reviewJoinRequest(tx: Tx, ctx: SchoolContext, requestId: string, input: JoinRequestReview) {
  const result = await tx.execute<{ id: string }>(sql`
    select id from app_private.review_join_request(
      ${ctx.schoolId}::uuid, ${requestId}::uuid, ${input.decision}, ${input.reason?.trim() ?? null},
      ${input.studentId ?? null}::uuid, ${input.guardianId ?? null}::uuid
    )
  `);
  const row = result.rows[0];
  if (!row) throw notFound("Membership request not found.");
  return getRequest(tx, ctx.schoolId, row.id);
}

export async function joinWithInvitation(tx: Tx, schoolId: string, token: string, role: JoinRequestInput["requestedRole"]) {
  const result = await tx.execute<{ school_id: string; role: string }>(sql`
    select school_id, role from app_private.accept_school_invitation(
      ${hashInvitationToken(token)}, ${schoolId}::uuid, ${role}::public.school_role
    )
  `);
  const row = result.rows[0];
  if (!row) throw notFound("Invitation not found.");
  return { schoolId: row.school_id, role: row.role };
}

export function listNotifications(tx: Tx, userId: string) {
  return tx.select().from(notificationsTable)
    .where(eq(notificationsTable.authUserId, userId))
    .orderBy(desc(notificationsTable.createdAt)).limit(100);
}

export async function markNotificationRead(tx: Tx, userId: string, notificationId: string) {
  const [notice] = await tx.select().from(notificationsTable).where(
    and(eq(notificationsTable.id, notificationId), eq(notificationsTable.authUserId, userId)),
  );
  if (!notice) throw notFound("Notification not found.");
  if (notice.readAt) return notice;
  const [updated] = await tx.update(notificationsTable).set({ readAt: new Date() }).where(
    and(eq(notificationsTable.id, notificationId), eq(notificationsTable.authUserId, userId)),
  ).returning();
  return updated;
}

export function listAnnouncements(tx: Tx, ctx: SchoolContext) {
  return tx.select().from(announcementsTable)
    .where(eq(announcementsTable.schoolId, ctx.schoolId))
    .orderBy(desc(announcementsTable.createdAt)).limit(100);
}

export async function publishAnnouncement(tx: Tx, ctx: SchoolContext, title: string, body: string) {
  const result = await tx.execute<{ id: string }>(sql`
    select id from app_private.publish_announcement(${ctx.schoolId}::uuid, ${title.trim()}, ${body.trim()})
  `);
  const row = result.rows[0];
  if (!row) throw notFound("Announcement not found.");
  const [announcement] = await tx.select().from(announcementsTable).where(
    and(eq(announcementsTable.id, row.id), eq(announcementsTable.schoolId, ctx.schoolId)),
  );
  return announcement;
}
