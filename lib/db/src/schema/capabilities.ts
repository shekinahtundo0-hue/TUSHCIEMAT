import { index, pgEnum, pgTable, primaryKey, timestamp, uuid } from "drizzle-orm/pg-core";
import { schoolMembershipsTable, schoolsTable } from "./schools";

export const schoolCapabilityEnum = pgEnum("school_capability", [
  "students.manage",
  "academics.manage",
  "attendance.manage",
  "people.manage",
  "requests.review",
  "settings.manage",
  "announcements.manage",
  "assessments.manage",
  "results.publish",
  "resources.manage",
  "records.delete",
  "staff.manage",
  "workload.manage",
  "communications.manage",
  "classroom.manage",
]);

// Only school_admin memberships receive explicit capabilities. The security
// migration validates the membership's school and role and audits every write.
// There is deliberately no default grant when a membership is created.
export const membershipCapabilitiesTable = pgTable(
  "membership_capabilities",
  {
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => schoolMembershipsTable.id),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schoolsTable.id),
    capability: schoolCapabilityEnum("capability").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "membership_capabilities_membership_capability_pk",
      columns: [table.membershipId, table.capability],
    }),
    index("membership_capabilities_school_idx").on(table.schoolId, table.membershipId),
  ],
).enableRLS();

export type SchoolCapability = (typeof schoolCapabilityEnum.enumValues)[number];
export type MembershipCapability = typeof membershipCapabilitiesTable.$inferSelect;
