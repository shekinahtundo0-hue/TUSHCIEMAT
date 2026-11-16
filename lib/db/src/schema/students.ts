import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { classesTable } from "./academics";
import { userProfilesTable } from "./identity";
import { schoolsTable } from "./schools";

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

export const guardianRelationshipEnum = pgEnum("guardian_relationship", [
  "mother",
  "father",
  "guardian",
  "grandparent",
  "sibling",
  "sponsor",
  "other",
]);

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
    // Set only when a learner accepts an invitation tied to this record.
    authUserId: text("auth_user_id").references(
      () => userProfilesTable.authUserId,
    ),
    status: studentStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("students_school_admission_unique").on(
      table.schoolId,
      table.admissionNumber,
    ),
    uniqueIndex("students_school_account_unique").on(
      table.schoolId,
      table.authUserId,
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

export const guardiansTable = pgTable(
  "guardians",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schoolsTable.id, { onDelete: "cascade" }),
    fullName: text("full_name").notNull(),
    email: text("email"),
    phone: text("phone"),
    // Set only when the guardian accepts an invitation tied to this record.
    authUserId: text("auth_user_id").references(
      () => userProfilesTable.authUserId,
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("guardians_school_account_unique").on(
      table.schoolId,
      table.authUserId,
    ),
    index("guardians_school_idx").on(table.schoolId),
  ],
);

export const studentGuardiansTable = pgTable(
  "student_guardians",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schoolsTable.id, { onDelete: "cascade" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => studentsTable.id, { onDelete: "cascade" }),
    guardianId: uuid("guardian_id")
      .notNull()
      .references(() => guardiansTable.id, { onDelete: "cascade" }),
    relationship: guardianRelationshipEnum("relationship").notNull(),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("student_guardians_pair_unique").on(
      table.studentId,
      table.guardianId,
    ),
    uniqueIndex("student_guardians_one_primary")
      .on(table.studentId)
      .where(sql`${table.isPrimary}`),
    index("student_guardians_guardian_idx").on(table.guardianId),
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
    recordedBy: text("recorded_by")
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

export type Student = typeof studentsTable.$inferSelect;
export type Guardian = typeof guardiansTable.$inferSelect;
export type StudentGuardian = typeof studentGuardiansTable.$inferSelect;
export type AttendanceRecord = typeof attendanceRecordsTable.$inferSelect;
export type GuardianRelationship = (typeof guardianRelationshipEnum.enumValues)[number];
