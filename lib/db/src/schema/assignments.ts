import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  decimal,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { classesTable } from "./academics";
import { userProfilesTable } from "./identity";
import { schoolsTable } from "./schools";
import { studentsTable } from "./students";

export const assignmentSubmissionStatusEnum = pgEnum("assignment_submission_status", [
  "not_started",
  "in_progress",
  "submitted",
  "graded",
  "overdue",
]);

/**
 * Assignments table - stores assignment metadata, instructions, resources, and deadlines
 */
export const assignmentsTable = pgTable(
  "assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schoolsTable.id, { onDelete: "cascade" }),
    classId: uuid("class_id")
      .notNull()
      .references(() => classesTable.id, { onDelete: "cascade" }),
    subject: text("subject").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    instructions: jsonb("instructions")
      .$type<Array<{ type: string; content: string; [key: string]: unknown }>>()
      .notNull()
      .default([]),
    attachedResourceIds: jsonb("attached_resource_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    marksAllocated: integer("marks_allocated").notNull(),
    deadlineDate: date("deadline_date").notNull(),
    deadlineTime: time("deadline_time"),
    allowResubmission: boolean("allow_resubmission").notNull().default(false),
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
    index("assignments_school_class_idx").on(table.schoolId, table.classId),
    uniqueIndex("assignments_class_subject_title_unique").on(
      table.classId,
      table.subject,
      table.title,
    ),
    check("assignments_marks_check", sql`${table.marksAllocated} > 0`),
  ],
);

/**
 * Assignment submissions table - stores student submissions and grading
 */
export const assignmentSubmissionsTable = pgTable(
  "assignment_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schoolsTable.id, { onDelete: "cascade" }),
    assignmentId: uuid("assignment_id")
      .notNull()
      .references(() => assignmentsTable.id, { onDelete: "cascade" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => studentsTable.id, { onDelete: "cascade" }),
    submissionText: text("submission_text"),
    submittedFiles: jsonb("submitted_files")
      .$type<Array<{ id: string; name: string; size: number; type: string }>>()
      .notNull()
      .default([]),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    markedAt: timestamp("marked_at", { withTimezone: true }),
    marksObtained: decimal("marks_obtained", { precision: 8, scale: 2 }),
    feedback: text("feedback"),
    gradedByUserId: text("graded_by_user_id").references(
      () => userProfilesTable.authUserId,
    ),
    status: assignmentSubmissionStatusEnum("status")
      .notNull()
      .default("not_started"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("assignment_submissions_unique").on(
      table.assignmentId,
      table.studentId,
    ),
    index("assignment_submissions_assignment_idx").on(table.assignmentId),
    index("assignment_submissions_student_idx").on(table.studentId),
    index("assignment_submissions_status_idx").on(table.status),
    check(
      "assignment_submissions_marks_check",
      sql`${table.marksObtained} IS NULL OR (${table.marksObtained} >= 0)`,
    ),
  ],
);

/**
 * Class timetables table - stores weekly class schedule
 */
export const classTimetablesTable = pgTable(
  "class_timetables",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schoolsTable.id, { onDelete: "cascade" }),
    classId: uuid("class_id")
      .notNull()
      .references(() => classesTable.id, { onDelete: "cascade" }),
    dayOfWeek: integer("day_of_week").notNull(),
    periodNumber: integer("period_number").notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    subject: text("subject").notNull(),
    teacherUserId: text("teacher_user_id")
      .notNull()
      .references(() => userProfilesTable.authUserId),
    roomLocation: text("room_location"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("class_timetables_unique").on(
      table.classId,
      table.dayOfWeek,
      table.periodNumber,
    ),
    index("class_timetables_class_day_idx").on(table.classId, table.dayOfWeek),
    check("class_timetables_day_check", sql`${table.dayOfWeek} >= 0 AND ${table.dayOfWeek} <= 6`),
    check(
      "class_timetables_time_check",
      sql`${table.startTime} < ${table.endTime}`,
    ),
  ],
);

export type Assignment = typeof assignmentsTable.$inferSelect;
export type AssignmentSubmission = typeof assignmentSubmissionsTable.$inferSelect;
export type ClassTimetable = typeof classTimetablesTable.$inferSelect;
export type AssignmentSubmissionStatus = (typeof assignmentSubmissionStatusEnum.enumValues)[number];
