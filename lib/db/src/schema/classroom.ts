import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  interval,
  jsonb,
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
import { studentsTable } from "./students";

export const resourceTypeEnum = pgEnum("resource_type", [
  "pdf",
  "docx",
  "pptx",
  "image",
  "video",
  "link",
  "other",
]);

export const learningResourcesTable = pgTable(
  "learning_resources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schoolsTable.id, { onDelete: "cascade" }),
    classId: uuid("class_id")
      .notNull()
      .references(() => classesTable.id, { onDelete: "cascade" }),
    lessonId: uuid("lesson_id").references(() => classLessonsTable.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    description: text("description"),
    learningObjectives: jsonb("learning_objectives")
      .$type<string[]>()
      .notNull()
      .default([]),
    resourceType: resourceTypeEnum("resource_type").notNull(),
    filePath: text("file_path"),
    fileName: text("file_name"),
    fileSizeBytes: integer("file_size_bytes"),
    uploadedByUserId: text("uploaded_by_user_id")
      .notNull()
      .references(() => userProfilesTable.authUserId),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    scheduledPublishAt: timestamp("scheduled_publish_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    isVisibleToStudents: boolean("is_visible_to_students").notNull().default(false),
    restrictedToStudentIds: jsonb("restricted_to_student_ids")
      .$type<string[]>()
      .default([]),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("learning_resources_class_idx").on(table.schoolId, table.classId),
    index("learning_resources_lesson_idx").on(table.lessonId),
    index("learning_resources_visible_idx")
      .on(table.classId, table.publishedAt)
      .where(sql`${table.isVisibleToStudents} AND ${table.deletedAt} IS NULL`),
    check(
      "learning_resources_publish_check",
      sql`
        CASE
          WHEN ${table.publishedAt} IS NOT NULL THEN ${table.isVisibleToStudents} = true
          WHEN ${table.scheduledPublishAt} IS NOT NULL THEN ${table.isVisibleToStudents} = false
          ELSE true
        END
      `,
    ),
  ],
);

export const classLessonsTable = pgTable(
  "class_lessons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schoolsTable.id, { onDelete: "cascade" }),
    classId: uuid("class_id")
      .notNull()
      .references(() => classesTable.id, { onDelete: "cascade" }),
    topic: text("topic"),
    unit: text("unit"),
    chapter: text("chapter"),
    lessonName: text("lesson_name").notNull(),
    orderIndex: integer("order_index").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("class_lessons_class_idx").on(table.classId),
    uniqueIndex("class_lessons_identity_unique").on(
      table.classId,
      table.topic,
      table.unit,
      table.chapter,
      table.lessonName,
    ),
  ],
);

export const resourceAccessLogsTable = pgTable(
  "resource_access_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schoolsTable.id, { onDelete: "cascade" }),
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => learningResourcesTable.id, { onDelete: "cascade" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => studentsTable.id, { onDelete: "cascade" }),
    accessedAt: timestamp("accessed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    wasDownloaded: boolean("was_downloaded").notNull().default(false),
    viewedDurationSeconds: integer("viewed_duration_seconds").default(0),
  },
  (table) => [
    index("resource_access_logs_resource_idx").on(table.resourceId),
    index("resource_access_logs_student_idx").on(table.studentId),
    index("resource_access_logs_school_date_idx").on(table.schoolId, table.accessedAt),
  ],
);

export const studentLearningProgressTable = pgTable(
  "student_learning_progress",
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
    lessonId: uuid("lesson_id")
      .notNull()
      .references(() => classLessonsTable.id, { onDelete: "cascade" }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    bookmarkedAt: timestamp("bookmarked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("student_learning_progress_unique").on(
      table.studentId,
      table.lessonId,
    ),
    index("student_learning_progress_student_idx").on(table.studentId),
    index("student_learning_progress_lesson_idx").on(table.lessonId),
  ],
);

export type LearningResource = typeof learningResourcesTable.$inferSelect;
export type ClassLesson = typeof classLessonsTable.$inferSelect;
export type ResourceAccessLog = typeof resourceAccessLogsTable.$inferSelect;
export type StudentLearningProgress = typeof studentLearningProgressTable.$inferSelect;
export type ResourceType = (typeof resourceTypeEnum.enumValues)[number];
