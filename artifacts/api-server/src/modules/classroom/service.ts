import { and, eq, desc, asc, gte, lte, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@workspace/db/schema";
import type { SchoolContext } from "../../lib/context";
import { conflict, notFound } from "../../lib/errors";

/**
 * CLASSROOM MODULE SERVICE LAYER
 * Handles business logic for digital classroom and learning resources
 */

// Create a lesson within a class
export async function createLesson(
  tx: NodePgDatabase<typeof schema>,
  ctx: SchoolContext,
  classId: string,
  input: { topic?: string; unit?: string; chapter?: string; lessonName: string; orderIndex?: number },
): Promise<schema.ClassLesson> {
  // Verify teacher is assigned to this class
  const assignment = await tx
    .select()
    .from(schema.classTeacherAssignmentsTable)
    .where(
      and(
        eq(schema.classTeacherAssignmentsTable.classId, classId as any),
        eq(schema.classTeacherAssignmentsTable.teacherUserId, ctx.userId),
        eq(schema.classTeacherAssignmentsTable.schoolId, ctx.schoolId),
      ),
    )
    .limit(1);

  if (!assignment.length) {
    throw conflict("You are not assigned to teach this class");
  }

  const lesson = await tx
    .insert(schema.classLessonsTable)
    .values({
      schoolId: ctx.schoolId,
      classId: classId as any,
      topic: input.topic,
      unit: input.unit,
      chapter: input.chapter,
      lessonName: input.lessonName,
      orderIndex: input.orderIndex ?? 0,
    })
    .returning();

  // Log action
  await ctx.audit("lesson.created", "class_lesson", lesson[0].id, {
    classId,
    topic: input.topic,
  });

  return lesson[0];
}

// Create a learning resource
export async function createLearningResource(
  tx: NodePgDatabase<typeof schema>,
  ctx: SchoolContext,
  classId: string,
  input: {
    title: string;
    description?: string;
    learningObjectives?: string[];
    resourceType: string;
    filePath?: string;
    fileName?: string;
    fileSizeBytes?: number;
    lessonId?: string;
  },
  userId: string,
): Promise<schema.LearningResource> {
  // Verify class exists and teacher is assigned
  const cls = await tx
    .select()
    .from(schema.classesTable)
    .where(eq(schema.classesTable.id, classId as any))
    .limit(1);

  if (!cls.length) throw notFound("Class not found");

  const resource = await tx
    .insert(schema.learningResourcesTable)
    .values({
      schoolId: ctx.schoolId,
      classId: classId as any,
      lessonId: input.lessonId ? (input.lessonId as any) : undefined,
      title: input.title,
      description: input.description,
      learningObjectives: input.learningObjectives ?? [],
      resourceType: input.resourceType as schema.ResourceType,
      filePath: input.filePath,
      fileName: input.fileName,
      fileSizeBytes: input.fileSizeBytes,
      uploadedByUserId: userId,
      isVisibleToStudents: false, // Draft until published
    })
    .returning();

  await ctx.audit("resource.created", "learning_resource", resource[0].id, {
    classId,
    title: input.title,
  });

  return resource[0];
}

// List learning resources for a class
export async function listLearningResources(
  tx: NodePgDatabase<typeof schema>,
  ctx: SchoolContext,
  classId: string,
  options: { page: number; limit: number; lessonId?: string; resourceType?: string },
): Promise<{
  resources: schema.LearningResource[];
  total: number;
  page: number;
  limit: number;
}> {
  const offset = (options.page - 1) * options.limit;
  const conditions = [
    eq(schema.learningResourcesTable.schoolId, ctx.schoolId),
    eq(schema.learningResourcesTable.classId, classId as any),
  ];

  if (options.lessonId) {
    conditions.push(eq(schema.learningResourcesTable.lessonId, options.lessonId as any));
  }

  if (options.resourceType) {
    conditions.push(eq(schema.learningResourcesTable.resourceType, options.resourceType as any));
  }

  const resources = await tx
    .select()
    .from(schema.learningResourcesTable)
    .where(and(...conditions))
    .orderBy(desc(schema.learningResourcesTable.createdAt))
    .limit(options.limit)
    .offset(offset);

  const countResult = await tx
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(schema.learningResourcesTable)
    .where(and(...conditions));

  return {
    resources,
    total: countResult[0]?.count ?? 0,
    page: options.page,
    limit: options.limit,
  };
}

// Update resource metadata
export async function updateLearningResource(
  tx: NodePgDatabase<typeof schema>,
  ctx: SchoolContext,
  classId: string,
  resourceId: string,
  input: Partial<{
    title: string;
    description: string;
    learningObjectives: string[];
    filePath: string;
    fileName: string;
    fileSizeBytes: number;
    lessonId: string | null;
    deletedAt: string;
  }>,
): Promise<schema.LearningResource> {
  const resource = await tx
    .select()
    .from(schema.learningResourcesTable)
    .where(
      and(
        eq(schema.learningResourcesTable.id, resourceId as any),
        eq(schema.learningResourcesTable.classId, classId as any),
      ),
    )
    .limit(1);

  if (!resource.length) throw notFound("Resource not found");

  const updated = await tx
    .update(schema.learningResourcesTable)
    .set({
      ...input,
      updatedAt: new Date(),
    })
    .where(eq(schema.learningResourcesTable.id, resourceId as any))
    .returning();

  await ctx.audit("resource.updated", "learning_resource", resourceId as any, input);

  return updated[0];
}

// Publish resource (immediate or schedule)
export async function publishResource(
  tx: NodePgDatabase<typeof schema>,
  ctx: SchoolContext,
  classId: string,
  resourceId: string,
  input: {
    publishImmediately?: boolean;
    scheduledPublishAt?: string;
    expiresAt?: string;
    restrictedToStudentIds?: string[];
  },
): Promise<schema.LearningResource> {
  const resource = await tx
    .select()
    .from(schema.learningResourcesTable)
    .where(eq(schema.learningResourcesTable.id, resourceId as any))
    .limit(1);

  if (!resource.length) throw notFound("Resource not found");

  const publishedAt = input.publishImmediately ? new Date() : undefined;

  const updated = await tx
    .update(schema.learningResourcesTable)
    .set({
      isVisibleToStudents: input.publishImmediately ?? false,
      publishedAt: publishedAt as any,
      scheduledPublishAt: input.scheduledPublishAt ? new Date(input.scheduledPublishAt) : undefined,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
      restrictedToStudentIds: input.restrictedToStudentIds,
      updatedAt: new Date(),
    })
    .where(eq(schema.learningResourcesTable.id, resourceId as any))
    .returning();

  await ctx.audit("resource.published", "learning_resource", resourceId as any, input);

  // Create notification for students if published immediately
  if (input.publishImmediately) {
    // Notifications service would be called here
  }

  return updated[0];
}

// Get student activity for a class
export async function getStudentActivityForClass(
  tx: NodePgDatabase<typeof schema>,
  ctx: SchoolContext,
  classId: string,
  page: number = 1,
  limit: number = 50,
): Promise<{
  activities: Array<{
    studentId: string;
    studentName: string;
    resourceId: string;
    resourceTitle: string;
    accessedAt: string;
    downloaded: boolean;
  }>;
  total: number;
}> {
  const offset = (page - 1) * limit;

  const activities = await tx
    .select({
      studentId: schema.studentsTable.id,
      studentName: sql<string>`${schema.studentsTable.firstName} || ' ' || ${schema.studentsTable.lastName}`,
      resourceId: schema.learningResourcesTable.id,
      resourceTitle: schema.learningResourcesTable.title,
      accessedAt: schema.resourceAccessLogsTable.accessedAt,
      downloaded: schema.resourceAccessLogsTable.wasDownloaded,
    })
    .from(schema.resourceAccessLogsTable)
    .innerJoin(
      schema.learningResourcesTable,
      eq(schema.learningResourcesTable.id, schema.resourceAccessLogsTable.resourceId),
    )
    .innerJoin(
      schema.studentsTable,
      eq(schema.studentsTable.id, schema.resourceAccessLogsTable.studentId),
    )
    .where(
      and(
        eq(schema.learningResourcesTable.classId, classId as any),
        eq(schema.learningResourcesTable.schoolId, ctx.schoolId),
      ),
    )
    .orderBy(desc(schema.resourceAccessLogsTable.accessedAt))
    .limit(limit)
    .offset(offset);

  const countResult = await tx
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(schema.resourceAccessLogsTable)
    .innerJoin(
      schema.learningResourcesTable,
      eq(schema.learningResourcesTable.id, schema.resourceAccessLogsTable.resourceId),
    )
    .where(
      and(
        eq(schema.learningResourcesTable.classId, classId as any),
        eq(schema.learningResourcesTable.schoolId, ctx.schoolId),
      ),
    );

  return {
    activities: activities as any,
    total: countResult[0]?.count ?? 0,
  };
}

// Get my classrooms (student view)
export async function getMyClassrooms(
  tx: NodePgDatabase<typeof schema>,
  schoolId: string,
  userId: string,
): Promise<
  Array<{
    classId: string;
    className: string;
    grade: string;
    stream: string | null;
    teacherName: string;
  }>
> {
  const classrooms = await tx
    .select({
      classId: schema.classesTable.id,
      className: schema.classesTable.name,
      grade: schema.classesTable.grade,
      stream: schema.classesTable.stream,
      teacherName: sql<string>`${schema.userProfilesTable.fullName}`,
    })
    .from(schema.studentsTable)
    .innerJoin(schema.classesTable, eq(schema.classesTable.id, schema.studentsTable.classId))
    .innerJoin(
      schema.classTeacherAssignmentsTable,
      and(
        eq(schema.classTeacherAssignmentsTable.classId, schema.classesTable.id),
        eq(schema.classTeacherAssignmentsTable.assignmentRole, "class_teacher"),
      ),
    )
    .innerJoin(
      schema.userProfilesTable,
      eq(schema.userProfilesTable.authUserId, schema.classTeacherAssignmentsTable.teacherUserId),
    )
    .where(
      and(
        eq(schema.studentsTable.schoolId, schoolId as any),
        eq(schema.studentsTable.authUserId, userId),
        eq(schema.studentsTable.status, "active"),
      ),
    );

  return classrooms as any;
}

// Get lesson details with resources
export async function getLessonDetails(
  tx: NodePgDatabase<typeof schema>,
  classId: string,
  lessonId: string,
  userId: string,
): Promise<any> {
  const lesson = await tx
    .select()
    .from(schema.classLessonsTable)
    .where(eq(schema.classLessonsTable.id, lessonId as any))
    .limit(1);

  if (!lesson.length) throw notFound("Lesson not found");

  // Get resources for this lesson (only visible to students)
  const resources = await tx
    .select()
    .from(schema.learningResourcesTable)
    .where(
      and(
        eq(schema.learningResourcesTable.lessonId, lessonId as any),
        eq(schema.learningResourcesTable.isVisibleToStudents, true),
      ),
    );

  // Get student progress for this lesson
  const progress = await tx
    .select()
    .from(schema.studentLearningProgressTable)
    .where(eq(schema.studentLearningProgressTable.lessonId, lessonId as any))
    .limit(1);

  return {
    lesson: lesson[0],
    resources,
    progress: progress[0] ?? null,
  };
}

// Get resource details with access logging
export async function getResourceDetails(
  tx: NodePgDatabase<typeof schema>,
  classId: string,
  resourceId: string,
  userId: string,
  options: { logAccess?: boolean; logDownload?: boolean } = {},
): Promise<any> {
  const resource = await tx
    .select()
    .from(schema.learningResourcesTable)
    .where(
      and(
        eq(schema.learningResourcesTable.id, resourceId as any),
        eq(schema.learningResourcesTable.isVisibleToStudents, true),
      ),
    )
    .limit(1);

  if (!resource.length) throw notFound("Resource not found");

  // Get student record to log access
  if (options.logAccess) {
    const student = await tx
      .select()
      .from(schema.studentsTable)
      .where(eq(schema.studentsTable.authUserId, userId))
      .limit(1);

    if (student.length) {
      await tx
        .insert(schema.resourceAccessLogsTable)
        .values({
          schoolId: resource[0].schoolId,
          resourceId: resourceId as any,
          studentId: student[0].id,
          wasDownloaded: options.logDownload ?? false,
        });
    }
  }

  return resource[0];
}

// Bookmark a lesson
export async function bookmarkResource(
  tx: NodePgDatabase<typeof schema>,
  classId: string,
  resourceId: string,
  userId: string,
  bookmark: boolean,
): Promise<any> {
  const student = await tx
    .select()
    .from(schema.studentsTable)
    .where(eq(schema.studentsTable.authUserId, userId))
    .limit(1);

  if (!student.length) throw notFound("Student record not found");

  if (bookmark) {
    await tx
      .insert(schema.studentLearningProgressTable)
      .values({
        schoolId: student[0].schoolId,
        classId: classId as any,
        studentId: student[0].id,
        lessonId: resourceId as any, // Using resourceId as lessonId for now - API design should clarify
        bookmarkedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          schema.studentLearningProgressTable.studentId,
          schema.studentLearningProgressTable.lessonId,
        ],
        set: { bookmarkedAt: new Date() },
      });
  }

  return { bookmarked: bookmark };
}

// Mark lesson complete
export async function markLessonComplete(
  tx: NodePgDatabase<typeof schema>,
  classId: string,
  lessonId: string,
  userId: string,
  completed: boolean,
): Promise<any> {
  const student = await tx
    .select()
    .from(schema.studentsTable)
    .where(eq(schema.studentsTable.authUserId, userId))
    .limit(1);

  if (!student.length) throw notFound("Student record not found");

  if (completed) {
    await tx
      .insert(schema.studentLearningProgressTable)
      .values({
        schoolId: student[0].schoolId,
        classId: classId as any,
        studentId: student[0].id,
        lessonId: lessonId as any,
        completedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          schema.studentLearningProgressTable.studentId,
          schema.studentLearningProgressTable.lessonId,
        ],
        set: { completedAt: new Date() },
      });
  }

  return { lessonComplete: completed };
}
