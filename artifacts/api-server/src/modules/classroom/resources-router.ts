import { Router } from "express";
import { and, eq, desc, gte, isNull, or, inArray, sql } from "drizzle-orm";
import {
  learningResourcesTable,
  resourceAccessLogsTable,
  studentLearningProgressTable,
  classLessonsTable,
  studentsTable,
  classesTable,
  userProfilesTable,
} from "@workspace/db/schema";
import { inSchool, send, currentUserId } from "../../lib/context";
import type { AppDeps } from "../../lib/deps";
import { parseInput, badRequest, forbidden, notFound } from "../../lib/errors";
import { ANY_MEMBER, STAFF } from "../../lib/roles";

// ============================================================================
// Helper Functions
// ============================================================================

async function getStudentId(tx: any, database: any, userId: string, schoolId: string): Promise<string | null> {
  const [student] = await tx
    .select({ id: studentsTable.id, classId: studentsTable.classId })
    .from(studentsTable)
    .where(
      and(
        eq(studentsTable.schoolId, schoolId),
        eq(studentsTable.authUserId, userId),
      ),
    );
  return student?.id || null;
}

async function getStudentClassId(
  tx: any,
  studentId: string,
  schoolId: string,
): Promise<string | null> {
  const [student] = await tx
    .select({ classId: studentsTable.classId })
    .from(studentsTable)
    .where(
      and(
        eq(studentsTable.id, studentId),
        eq(studentsTable.schoolId, schoolId),
      ),
    );
  return student?.classId || null;
}

function isResourceVisible(resource: any, now: Date): boolean {
  // Resource is visible if:
  // 1. publishedAt is in the past (or null and isVisibleToStudents is true)
  // 2. expiresAt is in the future (or null)
  const isPublished = !resource.publishedAt || new Date(resource.publishedAt) <= now;
  const notExpired = !resource.expiresAt || new Date(resource.expiresAt) > now;
  return resource.isVisibleToStudents && isPublished && notExpired;
}

// ============================================================================
// Route Handlers
// ============================================================================

export function resourcesRouter(deps: AppDeps): Router {
  const router = Router();
  const { database, logger } = deps;

  /**
   * GET /api/v1/learning/resources
   * Returns visible resources for student's class
   */
  router.get("/resources", async (req, res) => {
    const query = parseInput(
      {
        classId: { type: "string", required: false },
        subject: { type: "string", required: false },
        resourceType: { type: "string", required: false },
        limit: { type: "number", required: false, default: 20 },
        offset: { type: "number", required: false, default: 0 },
      },
      req.query,
    );

    await inSchool(database, req, res, ANY_MEMBER, async (tx, ctx) => {
      const userId = currentUserId(res);
      const studentId = await getStudentId(tx, database, userId, ctx.schoolId);

      let targetClassId = query.classId;
      if (studentId && !targetClassId) {
        targetClassId = await getStudentClassId(tx, studentId, ctx.schoolId);
      }

      if (!targetClassId) {
        throw badRequest(
          "Cannot determine class. Provide classId or enroll as student.",
          "no_class",
        );
      }

      // Build query for visible resources
      const now = new Date();
      let resourceQuery = tx
        .select()
        .from(learningResourcesTable)
        .where(
          and(
            eq(learningResourcesTable.schoolId, ctx.schoolId),
            eq(learningResourcesTable.classId, targetClassId),
            eq(learningResourcesTable.isVisibleToStudents, true),
            or(
              isNull(learningResourcesTable.publishedAt),
              gte(sql`now()`, learningResourcesTable.publishedAt),
            ),
            or(
              isNull(learningResourcesTable.expiresAt),
              gte(learningResourcesTable.expiresAt, sql`now()`),
            ),
            query.resourceType
              ? eq(learningResourcesTable.resourceType, query.resourceType)
              : undefined,
          ),
        );

      const resources = await resourceQuery
        .orderBy(desc(learningResourcesTable.publishedAt))
        .limit(query.limit)
        .offset(query.offset);

      const result = resources.map((r) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        resourceType: r.resourceType,
        fileName: r.fileName,
        fileSizeBytes: r.fileSizeBytes,
        publishedAt: r.publishedAt,
        expiresAt: r.expiresAt,
        createdAt: r.createdAt,
      }));

      send(res, { data: result, total: resources.length, hasMore: false });
    });
  });

  /**
   * GET /api/v1/learning/resources/:resourceId
   * Returns resource details + file metadata
   */
  router.get("/resources/:resourceId", async (req, res) => {
    const { resourceId } = req.params;

    await inSchool(database, req, res, ANY_MEMBER, async (tx, ctx) => {
      const [resource] = await tx
        .select()
        .from(learningResourcesTable)
        .where(
          and(
            eq(learningResourcesTable.id, resourceId),
            eq(learningResourcesTable.schoolId, ctx.schoolId),
          ),
        );

      if (!resource) throw notFound("Resource not found.");

      // Check visibility
      if (resource.isVisibleToStudents) {
        const now = new Date();
        if (
          resource.publishedAt &&
          new Date(resource.publishedAt) > now
        ) {
          throw notFound("Resource not yet published.");
        }
        if (resource.expiresAt && new Date(resource.expiresAt) <= now) {
          throw notFound("Resource has expired.");
        }
      }

      const result = {
        id: resource.id,
        title: resource.title,
        description: resource.description,
        resourceType: resource.resourceType,
        learningObjectives: resource.learningObjectives,
        fileName: resource.fileName,
        fileSizeBytes: resource.fileSizeBytes,
        publishedAt: resource.publishedAt,
        scheduledPublishAt: resource.scheduledPublishAt,
        expiresAt: resource.expiresAt,
        isVisibleToStudents: resource.isVisibleToStudents,
        createdAt: resource.createdAt,
        updatedAt: resource.updatedAt,
      };

      send(res, result);
    });
  });

  /**
   * GET /api/v1/learning/resources/:resourceId/download
   * Returns signed URL from Supabase Storage and logs access
   */
  router.get("/resources/:resourceId/download", async (req, res) => {
    const { resourceId } = req.params;

    await inSchool(database, req, res, ANY_MEMBER, async (tx, ctx) => {
      const userId = currentUserId(res);
      const studentId = await getStudentId(tx, database, userId, ctx.schoolId);

      const [resource] = await tx
        .select()
        .from(learningResourcesTable)
        .where(
          and(
            eq(learningResourcesTable.id, resourceId),
            eq(learningResourcesTable.schoolId, ctx.schoolId),
          ),
        );

      if (!resource || !resource.filePath) {
        throw notFound("Resource file not found.");
      }

      // Log access if student
      if (studentId) {
        await tx.insert(resourceAccessLogsTable).values({
          schoolId: ctx.schoolId,
          resourceId: resource.id,
          studentId,
          wasDownloaded: true,
        });
      }

      // Return signed URL (in real implementation, use Supabase client)
      // For now, return a mock URL structure
      const signedUrl = `/api/v1/learning/resources/${resourceId}/file`;

      send(res, { downloadUrl: signedUrl, fileName: resource.fileName });
    });
  });

  /**
   * POST /api/v1/learning/resources
   * Creates new learning resource (teacher/admin)
   */
  router.post("/resources", async (req, res) => {
    const { classId, title, description, resourceType, learningObjectives, lessonId, publishAt } =
      parseInput(
        {
          classId: { type: "string", required: true },
          title: { type: "string", required: true },
          description: { type: "string", required: false },
          resourceType: { type: "string", required: true },
          learningObjectives: { type: "array", required: false },
          lessonId: { type: "string", required: false },
          publishAt: { type: "string", required: false },
        },
        req.body,
      );

    if (!["pdf", "docx", "pptx", "image", "video", "link", "other"].includes(resourceType)) {
      throw badRequest("Invalid resource type.", "validation_failed");
    }

    await inSchool(
      database,
      req,
      res,
      { roles: STAFF, capability: "classroom.manage" },
      async (tx, ctx) => {
        const userId = currentUserId(res);

        // Verify class exists
        const [cls] = await tx
          .select()
          .from(classesTable)
          .where(
            and(
              eq(classesTable.id, classId),
              eq(classesTable.schoolId, ctx.schoolId),
            ),
          );

        if (!cls) throw notFound("Class not found.");

        // Verify lesson if provided
        if (lessonId) {
          const [lesson] = await tx
            .select()
            .from(classLessonsTable)
            .where(
              and(
                eq(classLessonsTable.id, lessonId),
                eq(classLessonsTable.classId, classId),
              ),
            );
          if (!lesson) throw notFound("Lesson not found in this class.");
        }

        const now = new Date();
        const publishedAt = publishAt ? new Date(publishAt) : null;

        const [resource] = await tx
          .insert(learningResourcesTable)
          .values({
            schoolId: ctx.schoolId,
            classId,
            lessonId: lessonId || null,
            title: title.trim(),
            description: description?.trim(),
            learningObjectives: learningObjectives || [],
            resourceType: resourceType as any,
            uploadedByUserId: userId,
            publishedAt,
            isVisibleToStudents: !!publishedAt,
            fileName: title,
            createdAt: now,
            updatedAt: now,
          })
          .returning();

        send(
          res,
          {
            id: resource.id,
            title: resource.title,
            resourceType: resource.resourceType,
            isVisibleToStudents: resource.isVisibleToStudents,
            publishedAt: resource.publishedAt,
            createdAt: resource.createdAt,
          },
          201,
        );
      },
    );
  });

  /**
   * GET /api/v1/learning/resources/recent
   * Returns recently added resources for student's class
   */
  router.get("/resources/recent", async (req, res) => {
    const query = parseInput(
      {
        limit: { type: "number", required: false, default: 10 },
      },
      req.query,
    );

    await inSchool(database, req, res, ANY_MEMBER, async (tx, ctx) => {
      const userId = currentUserId(res);
      const studentId = await getStudentId(tx, database, userId, ctx.schoolId);

      let targetClassId = null;
      if (studentId) {
        targetClassId = await getStudentClassId(tx, studentId, ctx.schoolId);
      }

      if (!targetClassId) {
        send(res, { data: [] });
        return;
      }

      const now = new Date();
      const resources = await tx
        .select()
        .from(learningResourcesTable)
        .where(
          and(
            eq(learningResourcesTable.schoolId, ctx.schoolId),
            eq(learningResourcesTable.classId, targetClassId),
            eq(learningResourcesTable.isVisibleToStudents, true),
            or(
              isNull(learningResourcesTable.publishedAt),
              gte(sql`now()`, learningResourcesTable.publishedAt),
            ),
            or(
              isNull(learningResourcesTable.expiresAt),
              gte(learningResourcesTable.expiresAt, sql`now()`),
            ),
          ),
        )
        .orderBy(desc(learningResourcesTable.publishedAt))
        .limit(query.limit);

      const result = resources.map((r) => ({
        id: r.id,
        title: r.title,
        resourceType: r.resourceType,
        publishedAt: r.publishedAt,
      }));

      send(res, { data: result });
    });
  });

  /**
   * GET /api/v1/learning/bookmarks
   * Returns bookmarked resources for current student
   */
  router.get("/bookmarks", async (req, res) => {
    const query = parseInput(
      {
        limit: { type: "number", required: false, default: 20 },
        offset: { type: "number", required: false, default: 0 },
      },
      req.query,
    );

    await inSchool(database, req, res, ANY_MEMBER, async (tx, ctx) => {
      const userId = currentUserId(res);
      const studentId = await getStudentId(tx, database, userId, ctx.schoolId);

      if (!studentId) {
        throw badRequest("User is not a student.", "not_a_student");
      }

      // Get bookmarked lessons
      const bookmarked = await tx
        .select()
        .from(studentLearningProgressTable)
        .where(
          and(
            eq(studentLearningProgressTable.studentId, studentId),
            eq(studentLearningProgressTable.schoolId, ctx.schoolId),
          ),
        );

      if (bookmarked.length === 0) {
        send(res, { data: [] });
        return;
      }

      const lessonIds = bookmarked
        .filter((b) => b.bookmarkedAt)
        .map((b) => b.lessonId);

      if (lessonIds.length === 0) {
        send(res, { data: [] });
        return;
      }

      const resources = await tx
        .select()
        .from(learningResourcesTable)
        .where(
          and(
            inArray(learningResourcesTable.lessonId, lessonIds),
            eq(learningResourcesTable.schoolId, ctx.schoolId),
            eq(learningResourcesTable.isVisibleToStudents, true),
          ),
        )
        .limit(query.limit)
        .offset(query.offset);

      const result = resources.map((r) => ({
        id: r.id,
        title: r.title,
        resourceType: r.resourceType,
        description: r.description,
        bookmarkedAt: bookmarked.find((b) => b.lessonId === r.lessonId)?.bookmarkedAt,
      }));

      send(res, { data: result });
    });
  });

  /**
   * POST /api/v1/learning/resources/:resourceId/bookmark
   * Toggles bookmark for a resource
   */
  router.post("/resources/:resourceId/bookmark", async (req, res) => {
    const { resourceId } = req.params;

    await inSchool(database, req, res, ANY_MEMBER, async (tx, ctx) => {
      const userId = currentUserId(res);
      const studentId = await getStudentId(tx, database, userId, ctx.schoolId);

      if (!studentId) {
        throw badRequest("User is not a student.", "not_a_student");
      }

      // Get resource to find lesson
      const [resource] = await tx
        .select()
        .from(learningResourcesTable)
        .where(
          and(
            eq(learningResourcesTable.id, resourceId),
            eq(learningResourcesTable.schoolId, ctx.schoolId),
          ),
        );

      if (!resource || !resource.lessonId) {
        throw notFound("Resource or associated lesson not found.");
      }

      // Check if already bookmarked
      const [existing] = await tx
        .select()
        .from(studentLearningProgressTable)
        .where(
          and(
            eq(studentLearningProgressTable.studentId, studentId),
            eq(studentLearningProgressTable.lessonId, resource.lessonId),
            eq(studentLearningProgressTable.schoolId, ctx.schoolId),
          ),
        );

      if (existing) {
        // Toggle: if bookmarked, remove; if not bookmarked, add
        const toggledAt = existing.bookmarkedAt ? null : new Date();
        await tx
          .update(studentLearningProgressTable)
          .set({ bookmarkedAt: toggledAt })
          .where(eq(studentLearningProgressTable.id, existing.id));

        send(res, { bookmarked: !!toggledAt });
      } else {
        // Create and bookmark
        await tx.insert(studentLearningProgressTable).values({
          schoolId: ctx.schoolId,
          classId: resource.classId,
          studentId,
          lessonId: resource.lessonId,
          bookmarkedAt: new Date(),
        });

        send(res, { bookmarked: true });
      }
    });
  });

  /**
   * GET /api/v1/learning/lessons/:classId
   * Returns lessons organized by unit/chapter
   */
  router.get("/lessons/:classId", async (req, res) => {
    const { classId } = req.params;

    await inSchool(database, req, res, ANY_MEMBER, async (tx, ctx) => {
      // Verify class exists
      const [cls] = await tx
        .select()
        .from(classesTable)
        .where(
          and(
            eq(classesTable.id, classId),
            eq(classesTable.schoolId, ctx.schoolId),
          ),
        );

      if (!cls) throw notFound("Class not found.");

      // Get lessons grouped by unit/chapter
      const lessons = await tx
        .select()
        .from(classLessonsTable)
        .where(
          and(
            eq(classLessonsTable.classId, classId),
            eq(classLessonsTable.schoolId, ctx.schoolId),
          ),
        )
        .orderBy(
          classLessonsTable.unit,
          classLessonsTable.chapter,
          classLessonsTable.orderIndex,
        );

      // Group by unit and chapter
      const grouped: Record<string, Record<string, any>> = {};
      lessons.forEach((lesson) => {
        const unit = lesson.unit || "General";
        const chapter = lesson.chapter || "General";

        if (!grouped[unit]) grouped[unit] = {};
        if (!grouped[unit][chapter]) grouped[unit][chapter] = [];

        grouped[unit][chapter].push({
          id: lesson.id,
          name: lesson.lessonName,
          topic: lesson.topic,
        });
      });

      const result = Object.entries(grouped).map(([unit, chapters]) => ({
        unit,
        chapters: Object.entries(chapters).map(([chapter, lessons]) => ({
          chapter,
          lessons,
        })),
      }));

      send(res, { data: result });
    });
  });

  return router;
}

export default resourcesRouter;
