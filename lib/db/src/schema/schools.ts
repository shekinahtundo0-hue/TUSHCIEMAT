import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { userProfilesTable } from "./identity";

export const schoolRoleEnum = pgEnum("school_role", [
  "owner",
  "school_admin",
  "principal",
  "academic_admin",
  "bursar",
  "teacher",
  "parent",
  "student",
  "tutor",
]);

export const membershipStatusEnum = pgEnum("membership_status", [
  "active",
  "suspended",
]);

export const schoolCategoryEnum = pgEnum("school_category", [
  "primary",
  "secondary",
  "mixed",
  "tertiary",
  "other",
]);

export const schoolsTable = pgTable(
  "schools",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    category: schoolCategoryEnum("category").notNull(),
    curriculum: text("curriculum").notNull(),
    country: text("country").notNull().default("Kenya"),
    county: text("county"),
    town: text("town"),
    logoUrl: text("logo_url"),
    description: text("description"),
    contactEmail: text("contact_email"),
    contactPhone: text("contact_phone"),
    website: text("website"),
    verificationStatus: text("verification_status").notNull().default("unverified"),
    discoverable: boolean("discoverable").notNull().default(false),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => userProfilesTable.authUserId),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("schools_slug_unique").on(table.slug),
    index("schools_created_by_idx").on(table.createdByUserId),
    index("schools_directory_name_idx")
      .on(sql`lower(btrim(regexp_replace(${table.name}, '[[:space:]]+', ' ', 'g')))`, table.id)
      .where(sql`${table.discoverable}`),
    check(
      "schools_verification_status_check",
      sql`${table.verificationStatus} IN ('unverified', 'verified')`,
    ),
  ],
);

// A person may hold several roles in one school (e.g. a teacher who is also a parent).
export const schoolMembershipsTable = pgTable(
  "school_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schoolsTable.id, { onDelete: "cascade" }),
    authUserId: text("auth_user_id")
      .notNull()
      .references(() => userProfilesTable.authUserId),
    role: schoolRoleEnum("role").notNull(),
    status: membershipStatusEnum("status").notNull().default("active"),
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("school_memberships_school_user_role_unique").on(
      table.schoolId,
      table.authUserId,
      table.role,
    ),
    index("school_memberships_user_idx").on(table.authUserId, table.status),
    index("school_memberships_school_role_idx")
      .on(table.schoolId, table.role)
      .where(sql`${table.status} = 'active'`),
  ],
);

export const auditLogsTable = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schoolsTable.id, { onDelete: "cascade" }),
    actorUserId: text("actor_user_id").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("audit_logs_school_created_idx").on(table.schoolId, table.createdAt),
  ],
);

export type School = typeof schoolsTable.$inferSelect;
export type SchoolMembership = typeof schoolMembershipsTable.$inferSelect;
export type AuditLog = typeof auditLogsTable.$inferSelect;
export type SchoolRole = (typeof schoolRoleEnum.enumValues)[number];
export type SchoolCategory = (typeof schoolCategoryEnum.enumValues)[number];
