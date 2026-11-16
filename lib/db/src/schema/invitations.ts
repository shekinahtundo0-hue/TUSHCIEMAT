import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { userProfilesTable } from "./identity";
import { schoolRoleEnum, schoolsTable } from "./schools";
import { guardiansTable, studentsTable } from "./students";

export const invitationStatusEnum = pgEnum("invitation_status", [
  "pending",
  "accepted",
  "revoked",
]);

// Only the SHA-256 of the invitation token is stored; the token itself is shown once.
export const invitationsTable = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schoolsTable.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: schoolRoleEnum("role").notNull(),
    tokenHash: text("token_hash").notNull(),
    status: invitationStatusEnum("status").notNull().default("pending"),
    studentId: uuid("student_id").references(() => studentsTable.id, {
      onDelete: "cascade",
    }),
    guardianId: uuid("guardian_id").references(() => guardiansTable.id, {
      onDelete: "cascade",
    }),
    invitedByUserId: text("invited_by_user_id")
      .notNull()
      .references(() => userProfilesTable.authUserId),
    acceptedByUserId: text("accepted_by_user_id").references(
      () => userProfilesTable.authUserId,
    ),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("invitations_token_hash_unique").on(table.tokenHash),
    uniqueIndex("invitations_one_pending")
      .on(table.schoolId, table.email, table.role)
      .where(sql`${table.status} = 'pending'`),
    index("invitations_school_status_idx").on(table.schoolId, table.status),
    check("invitations_email_lowercase", sql`${table.email} = lower(${table.email})`),
    check(
      "invitations_student_link",
      sql`(${table.role} = 'student') = (${table.studentId} IS NOT NULL)`,
    ),
    check(
      "invitations_guardian_link",
      sql`(${table.role} = 'parent') = (${table.guardianId} IS NOT NULL)`,
    ),
  ],
);

export type Invitation = typeof invitationsTable.$inferSelect;
