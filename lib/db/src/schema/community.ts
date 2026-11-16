import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { userProfilesTable } from "./identity";
import { schoolRoleEnum, schoolsTable } from "./schools";
import { guardiansTable, studentsTable } from "./students";

export const schoolJoinRequestsTable = pgTable(
  "school_join_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id").notNull().references(() => schoolsTable.id, { onDelete: "cascade" }),
    authUserId: text("auth_user_id").notNull().references(() => userProfilesTable.authUserId),
    requestedRole: schoolRoleEnum("requested_role").notNull(),
    schoolName: text("school_name").notNull(),
    applicantName: text("applicant_name").notNull(),
    applicantEmail: text("applicant_email").notNull(),
    applicantDetails: jsonb("applicant_details").$type<Record<string, unknown>>().notNull(),
    status: text("status").notNull().default("pending"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    reviewedByUserId: text("reviewed_by_user_id").references(() => userProfilesTable.authUserId),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason"),
    studentId: uuid("student_id").references(() => studentsTable.id),
    guardianId: uuid("guardian_id").references(() => guardiansTable.id),
  },
  (table) => [
    uniqueIndex("school_join_requests_one_pending")
      .on(table.schoolId, table.authUserId, table.requestedRole)
      .where(sql`${table.status} = 'pending'`),
    index("school_join_requests_school_date_idx").on(table.schoolId, table.submittedAt.desc()),
    index("school_join_requests_user_date_idx").on(table.authUserId, table.submittedAt.desc()),
    check("school_join_requests_role_check", sql`${table.requestedRole} IN ('student', 'teacher', 'school_admin', 'parent')`),
    check("school_join_requests_status_check", sql`${table.status} IN ('pending', 'approved', 'rejected')`),
    check("school_join_requests_details_check", sql`jsonb_typeof(${table.applicantDetails}) = 'object' AND octet_length(${table.applicantDetails}::text) <= 8000`),
    check("school_join_requests_review_check", sql`
      (${table.status} = 'pending' AND ${table.reviewedByUserId} IS NULL AND ${table.reviewedAt} IS NULL
        AND ${table.rejectionReason} IS NULL AND ${table.studentId} IS NULL AND ${table.guardianId} IS NULL)
      OR (${table.status} = 'approved' AND ${table.reviewedByUserId} IS NOT NULL AND ${table.reviewedAt} IS NOT NULL
        AND ${table.reviewedByUserId} <> ${table.authUserId} AND ${table.rejectionReason} IS NULL
        AND ((${table.requestedRole} = 'student' AND ${table.studentId} IS NOT NULL AND ${table.guardianId} IS NULL)
          OR (${table.requestedRole} = 'parent' AND ${table.guardianId} IS NOT NULL AND ${table.studentId} IS NULL)
          OR (${table.requestedRole} IN ('teacher', 'school_admin') AND ${table.studentId} IS NULL AND ${table.guardianId} IS NULL)))
      OR (${table.status} = 'rejected' AND ${table.reviewedByUserId} IS NOT NULL AND ${table.reviewedAt} IS NOT NULL
        AND ${table.reviewedByUserId} <> ${table.authUserId} AND ${table.rejectionReason} IS NOT NULL
        AND char_length(btrim(${table.rejectionReason})) BETWEEN 3 AND 500
        AND ${table.studentId} IS NULL AND ${table.guardianId} IS NULL)
    `),
  ],
);

export const notificationsTable = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id").notNull().references(() => schoolsTable.id, { onDelete: "cascade" }),
    authUserId: text("auth_user_id").notNull().references(() => userProfilesTable.authUserId),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    entityId: uuid("entity_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (table) => [index("notifications_recipient_date_idx").on(table.authUserId, table.createdAt.desc())],
);

export const announcementsTable = pgTable(
  "announcements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id").notNull().references(() => schoolsTable.id, { onDelete: "cascade" }),
    authorUserId: text("author_user_id").notNull().references(() => userProfilesTable.authUserId),
    title: text("title").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("announcements_school_date_idx").on(table.schoolId, table.createdAt.desc())],
);

export type SchoolJoinRequest = typeof schoolJoinRequestsTable.$inferSelect;
export type Notification = typeof notificationsTable.$inferSelect;
export type Announcement = typeof announcementsTable.$inferSelect;
