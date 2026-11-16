import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  decimal,
  integer,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { classesTable, termsTable } from "./academics";
import { userProfilesTable } from "./identity";
import { schoolsTable } from "./schools";
import { studentsTable } from "./students";

export const assessmentSubmissionStatusEnum = pgEnum("assessment_submission_status", [
  "pending",
  "submitted",
  "marked",
]);

export const resultPublicationStatusEnum = pgEnum("result_publication_status", [
  "draft",
  "pending_review",
  "approved",
  "published",
  "rejected",
]);

export const assessmentTypesTable = pgTable(
  "assessment_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schoolsTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    maxMarks: integer("max_marks").notNull(),
    weight: decimal("weight", { precision: 5, scale: 2 }).notNull().default("100"),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => userProfilesTable.authUserId),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("assessment_types_school_idx").on(table.schoolId),
    check("assessment_types_max_marks_check", sql`${table.maxMarks} > 0`),
    check("assessment_types_weight_check", sql`${table.weight} > 0 AND ${table.weight} <= 100`),
  ],
);

export const assessmentsTable = pgTable(
  "assessments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schoolsTable.id, { onDelete: "cascade" }),
    termId: uuid("term_id")
      .notNull()
      .references(() => termsTable.id, { onDelete: "cascade" }),
    classId: uuid("class_id")
      .notNull()
      .references(() => classesTable.id, { onDelete: "cascade" }),
    assessmentTypeId: uuid("assessment_type_id")
      .notNull()
      .references(() => assessmentTypesTable.id, { onDelete: "restrict" }),
    subject: text("subject").notNull(),
    maxMarks: integer("max_marks").notNull(),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => userProfilesTable.authUserId),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("assessments_term_idx").on(table.termId),
    index("assessments_class_idx").on(table.classId),
    index("assessments_type_idx").on(table.assessmentTypeId),
    uniqueIndex("assessments_identity_unique").on(
      table.classId,
      table.termId,
      table.subject,
      table.assessmentTypeId,
    ),
    check("assessments_max_marks_check", sql`${table.maxMarks} > 0`),
  ],
);

export const studentAssessmentMarksTable = pgTable(
  "student_assessment_marks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schoolsTable.id, { onDelete: "cascade" }),
    assessmentId: uuid("assessment_id")
      .notNull()
      .references(() => assessmentsTable.id, { onDelete: "cascade" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => studentsTable.id, { onDelete: "cascade" }),
    marksObtained: decimal("marks_obtained", { precision: 8, scale: 2 }),
    markedByUserId: text("marked_by_user_id").references(
      () => userProfilesTable.authUserId,
    ),
    markedAt: timestamp("marked_at", { withTimezone: true }),
    feedback: text("feedback"),
    editCount: integer("edit_count").notNull().default(0),
    lastEditedByUserId: text("last_edited_by_user_id").references(
      () => userProfilesTable.authUserId,
    ),
    lastEditedAt: timestamp("last_edited_at", { withTimezone: true }),
    submissionStatus: assessmentSubmissionStatusEnum("submission_status")
      .notNull()
      .default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("student_assessment_marks_unique").on(
      table.assessmentId,
      table.studentId,
    ),
    index("student_assessment_marks_assessment_idx").on(table.assessmentId),
    index("student_assessment_marks_student_idx").on(table.studentId),
    check(
      "student_assessment_marks_value_check",
      sql`${table.marksObtained} IS NULL OR (${table.marksObtained} >= 0)`,
    ),
  ],
);

export const gradingScalesTable = pgTable(
  "grading_scales",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schoolsTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    gradeBands: jsonb("grade_bands")
      .$type<
        Array<{
          min: number;
          max: number;
          grade: string;
          gpa?: number;
        }>
      >()
      .notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("grading_scales_school_idx").on(table.schoolId),
    uniqueIndex("grading_scales_school_default_unique")
      .on(table.schoolId)
      .where(sql`${table.isDefault}`),
  ],
);

export const resultPublicationsTable = pgTable(
  "result_publications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schoolsTable.id, { onDelete: "cascade" }),
    termId: uuid("term_id")
      .notNull()
      .references(() => termsTable.id, { onDelete: "cascade" }),
    classId: uuid("class_id").references(() => classesTable.id, {
      onDelete: "cascade",
    }),
    publishedByUserId: text("published_by_user_id")
      .notNull()
      .references(() => userProfilesTable.authUserId),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    isPublished: boolean("is_published").notNull().default(false),
    status: resultPublicationStatusEnum("status").notNull().default("draft"),
    reviewedByUserId: text("reviewed_by_user_id").references(
      () => userProfilesTable.authUserId,
    ),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("result_publications_school_term_idx").on(table.schoolId, table.termId),
    index("result_publications_status_idx").on(table.status),
    check(
      "result_publications_status_check",
      sql`
        (${table.status} = 'published' AND ${table.isPublished} = true AND ${table.publishedAt} IS NOT NULL)
        OR (${table.status} = 'draft' AND ${table.isPublished} = false AND ${table.publishedAt} IS NULL)
        OR (${table.status} IN ('pending_review', 'approved', 'rejected'))
      `,
    ),
  ],
);

export const studentTermAggregatesTable = pgTable(
  "student_term_aggregates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schoolsTable.id, { onDelete: "cascade" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => studentsTable.id, { onDelete: "cascade" }),
    termId: uuid("term_id")
      .notNull()
      .references(() => termsTable.id, { onDelete: "cascade" }),
    classId: uuid("class_id")
      .notNull()
      .references(() => classesTable.id, { onDelete: "cascade" }),
    subject: text("subject").notNull(),
    totalMarks: decimal("total_marks", { precision: 8, scale: 2 }),
    averagePercentage: decimal("average_percentage", { precision: 5, scale: 2 }),
    grade: text("grade"),
    positionInClass: integer("position_in_class"),
    calculatedAt: timestamp("calculated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("student_term_aggregates_unique").on(
      table.studentId,
      table.termId,
      table.subject,
    ),
    index("student_term_aggregates_term_class_idx").on(table.termId, table.classId),
  ],
);

export type AssessmentType = typeof assessmentTypesTable.$inferSelect;
export type Assessment = typeof assessmentsTable.$inferSelect;
export type StudentAssessmentMark = typeof studentAssessmentMarksTable.$inferSelect;
export type GradingScale = typeof gradingScalesTable.$inferSelect;
export type ResultPublication = typeof resultPublicationsTable.$inferSelect;
export type StudentTermAggregate = typeof studentTermAggregatesTable.$inferSelect;
