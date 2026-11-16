import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { userProfilesTable } from "./identity";
import { schoolsTable } from "./schools";

export const teacherAssignmentRoleEnum = pgEnum("teacher_assignment_role", [
  "class_teacher",
  "subject_teacher",
]);

export const academicYearsTable = pgTable(
  "academic_years",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schoolsTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    startsOn: date("starts_on", { mode: "string" }).notNull(),
    endsOn: date("ends_on", { mode: "string" }).notNull(),
    isCurrent: boolean("is_current").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("academic_years_school_name_unique").on(table.schoolId, table.name),
    uniqueIndex("academic_years_one_current")
      .on(table.schoolId)
      .where(sql`${table.isCurrent}`),
    check("academic_years_dates_check", sql`${table.endsOn} > ${table.startsOn}`),
  ],
);

export const termsTable = pgTable(
  "terms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schoolsTable.id, { onDelete: "cascade" }),
    academicYearId: uuid("academic_year_id")
      .notNull()
      .references(() => academicYearsTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    startsOn: date("starts_on", { mode: "string" }).notNull(),
    endsOn: date("ends_on", { mode: "string" }).notNull(),
    isCurrent: boolean("is_current").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("terms_year_name_unique").on(table.academicYearId, table.name),
    uniqueIndex("terms_one_current")
      .on(table.schoolId)
      .where(sql`${table.isCurrent}`),
    index("terms_school_idx").on(table.schoolId),
    check("terms_dates_check", sql`${table.endsOn} > ${table.startsOn}`),
  ],
);

export const classesTable = pgTable(
  "school_classes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schoolsTable.id, { onDelete: "cascade" }),
    academicYearId: uuid("academic_year_id")
      .notNull()
      .references(() => academicYearsTable.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    grade: text("grade").notNull(),
    stream: text("stream"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("school_classes_identity_unique").on(
      table.schoolId,
      table.academicYearId,
      table.name,
    ),
    index("school_classes_year_idx").on(table.academicYearId),
  ],
);

export const classTeacherAssignmentsTable = pgTable(
  "class_teacher_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schoolsTable.id, { onDelete: "cascade" }),
    classId: uuid("class_id")
      .notNull()
      .references(() => classesTable.id, { onDelete: "cascade" }),
    teacherUserId: text("teacher_user_id")
      .notNull()
      .references(() => userProfilesTable.authUserId),
    assignmentRole: teacherAssignmentRoleEnum("assignment_role").notNull(),
    subject: text("subject"),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("class_teacher_assignments_unique")
      .on(table.classId, table.teacherUserId, table.subject)
      .nullsNotDistinct(),
    uniqueIndex("class_teacher_assignments_one_class_teacher")
      .on(table.classId)
      .where(sql`${table.assignmentRole} = 'class_teacher'`),
    index("class_teacher_assignments_teacher_idx").on(
      table.teacherUserId,
      table.schoolId,
    ),
    check(
      "class_teacher_assignments_subject_check",
      sql`(${table.assignmentRole} = 'subject_teacher') = (${table.subject} IS NOT NULL)`,
    ),
  ],
);

export type AcademicYear = typeof academicYearsTable.$inferSelect;
export type Term = typeof termsTable.$inferSelect;
export type SchoolClass = typeof classesTable.$inferSelect;
export type ClassTeacherAssignment = typeof classTeacherAssignmentsTable.$inferSelect;
