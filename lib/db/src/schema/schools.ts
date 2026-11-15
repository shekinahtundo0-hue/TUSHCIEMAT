import { createInsertSchema } from "drizzle-zod";
import {
  date,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";

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
  "platform_admin",
]);

export const membershipStatusEnum = pgEnum("membership_status", [
  "active",
  "invited",
  "suspended",
]);

export const studentStatusEnum = pgEnum("student_status", [
  "active",
  "transferred",
  "graduated",
  "inactive",
]);

export const attendanceStatusEnum = pgEnum("attendance_status", [
  "present",
  "absent",
  "late",
  "excused",
]);

export const schoolsTable = pgTable(
  "schools",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    category: text("category").notNull(),
    curriculum: text("curriculum").notNull(),
    county: text("county"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("schools_slug_unique").on(table.slug)],
);

export const schoolMembershipsTable = pgTable(
  "school_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schoolsTable.id, { onDelete: "cascade" }),
    clerkUserId: text("clerk_user_id").notNull(),
    role: schoolRoleEnum("role").notNull(),
    status: membershipStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("school_memberships_school_user_unique").on(
      table.schoolId,
      table.clerkUserId,
    ),
    index("school_memberships_user_idx").on(table.clerkUserId, table.status),
  ],
);

export const classesTable = pgTable(
  "school_classes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schoolsTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    grade: text("grade").notNull(),
    stream: text("stream"),
    academicYear: text("academic_year").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("school_classes_identity_unique").on(
      table.schoolId,
      table.name,
      table.academicYear,
    ),
    index("school_classes_school_idx").on(table.schoolId),
  ],
);

export const studentsTable = pgTable(
  "students",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schoolsTable.id, { onDelete: "cascade" }),
    classId: uuid("class_id").references(() => classesTable.id, {
      onDelete: "set null",
    }),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    admissionNumber: text("admission_number").notNull(),
    guardianName: text("guardian_name"),
    guardianEmail: text("guardian_email"),
    guardianPhone: text("guardian_phone"),
    status: studentStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("students_school_admission_unique").on(
      table.schoolId,
      table.admissionNumber,
    ),
    index("students_school_class_idx").on(
      table.schoolId,
      table.classId,
      table.status,
    ),
    index("students_name_search_idx").on(
      table.schoolId,
      table.lastName,
      table.firstName,
    ),
  ],
);

export const attendanceRecordsTable = pgTable(
  "attendance_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schoolsTable.id, { onDelete: "cascade" }),
    classId: uuid("class_id")
      .notNull()
      .references(() => classesTable.id, { onDelete: "cascade" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => studentsTable.id, { onDelete: "cascade" }),
    attendanceDate: date("attendance_date", { mode: "string" }).notNull(),
    status: attendanceStatusEnum("status").notNull(),
    note: text("note"),
    recordedBy: text("recorded_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("attendance_student_date_unique").on(
      table.studentId,
      table.attendanceDate,
    ),
    index("attendance_school_date_class_idx").on(
      table.schoolId,
      table.attendanceDate,
      table.classId,
    ),
  ],
);

export const auditLogsTable = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schoolsTable.id, { onDelete: "cascade" }),
    actorClerkUserId: text("actor_clerk_user_id").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("audit_logs_school_created_idx").on(table.schoolId, table.createdAt),
  ],
);

export const insertSchoolSchema = createInsertSchema(schoolsTable).omit({
  id: true,
  slug: true,
  createdAt: true,
});
export const insertSchoolMembershipSchema = createInsertSchema(
  schoolMembershipsTable,
).omit({ id: true, createdAt: true });
export const insertClassSchema = createInsertSchema(classesTable).omit({
  id: true,
  createdAt: true,
});
export const insertStudentSchema = createInsertSchema(studentsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertAttendanceRecordSchema = createInsertSchema(
  attendanceRecordsTable,
).omit({ id: true, createdAt: true, updatedAt: true });
export const insertAuditLogSchema = createInsertSchema(auditLogsTable).omit({
  id: true,
  createdAt: true,
});

export type School = typeof schoolsTable.$inferSelect;
export type SchoolMembership = typeof schoolMembershipsTable.$inferSelect;
export type SchoolClass = typeof classesTable.$inferSelect;
export type Student = typeof studentsTable.$inferSelect;
export type AttendanceRecord = typeof attendanceRecordsTable.$inferSelect;
export type AuditLog = typeof auditLogsTable.$inferSelect;
export type SchoolRole = (typeof schoolRoleEnum.enumValues)[number];
export type InsertSchool = z.infer<typeof insertSchoolSchema>;
export type InsertClass = z.infer<typeof insertClassSchema>;
export type InsertStudent = z.infer<typeof insertStudentSchema>;
