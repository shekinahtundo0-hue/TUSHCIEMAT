import { Router } from "express";
import { z } from "zod";
import { currentUserId, inSchool, send } from "../../lib/context";
import type { AppDeps } from "../../lib/deps";
import { parseInput } from "../../lib/errors";
import { ANY_MEMBER, CLASSROOM_MANAGERS } from "../../lib/roles";
import {
  createLesson,
  createLearningResource,
  updateLearningResource,
  publishResource,
  getStudentActivityForClass,
  getMyClassrooms,
  getLessonDetails,
  getResourceDetails,
  bookmarkResource,
  markLessonComplete,
  listLearningResources,
} from "./service";

// These routes are not mounted in app.ts; the mounted surface lives in
// resources-router.ts under /learning. Schemas are inline (not in the OpenAPI
// spec) so no dead contract surface is generated for them.

const MANAGE_ACCESS = {
  roles: CLASSROOM_MANAGERS,
  capability: "classroom.manage",
  scopedRoles: ["teacher"],
} as const;

const RESOURCE_TYPES = ["pdf", "docx", "pptx", "image", "video", "link", "other"] as const;

const uuidParam = z.string().uuid();
const classIdParam = z.object({ classId: uuidParam });
const resourceParams = z.object({ classId: uuidParam, resourceId: uuidParam });
const lessonParams = z.object({ classId: uuidParam, lessonId: uuidParam });

const CreateLessonBody = z.object({
  topic: z.string().max(200).optional(),
  unit: z.string().max(200).optional(),
  chapter: z.string().max(200).optional(),
  lessonName: z.string().min(1).max(200),
  orderIndex: z.number().int().min(0).optional(),
});

const CreateResourceBody = z.object({
  title: z.string().min(2).max(200),
  description: z.string().max(2000).optional(),
  learningObjectives: z.array(z.string().max(500)).max(20).optional(),
  resourceType: z.enum(RESOURCE_TYPES),
  filePath: z.string().max(1000).optional(),
  fileName: z.string().max(300).optional(),
  fileSizeBytes: z.number().int().min(0).optional(),
  lessonId: uuidParam.optional(),
});

const UpdateResourceBody = z.object({
  title: z.string().min(2).max(200).optional(),
  description: z.string().max(2000).optional(),
  learningObjectives: z.array(z.string().max(500)).max(20).optional(),
  filePath: z.string().max(1000).optional(),
  fileName: z.string().max(300).optional(),
  fileSizeBytes: z.number().int().min(0).optional(),
  lessonId: uuidParam.nullable().optional(),
});

const PublishResourceBody = z.object({
  publishImmediately: z.boolean().optional(),
  scheduledPublishAt: z.coerce.date().optional(),
  expiresAt: z.coerce.date().optional(),
  restrictedToStudentIds: z.array(uuidParam).optional(),
});

const BookmarkBody = z.object({ bookmark: z.boolean() });
const MarkCompleteBody = z.object({ completed: z.boolean() });

const PageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  lessonId: uuidParam.optional(),
  resourceType: z.enum(RESOURCE_TYPES).optional(),
});

const LessonSchema = z.object({
  id: uuidParam,
  schoolId: uuidParam,
  classId: uuidParam,
  topic: z.string().nullable(),
  unit: z.string().nullable(),
  chapter: z.string().nullable(),
  lessonName: z.string(),
  orderIndex: z.number().int(),
  createdAt: z.coerce.date(),
});

const ResourceSchema = z.object({
  id: uuidParam,
  schoolId: uuidParam,
  classId: uuidParam,
  lessonId: uuidParam.nullable(),
  title: z.string(),
  description: z.string().nullable(),
  learningObjectives: z.array(z.string()),
  resourceType: z.enum(RESOURCE_TYPES),
  filePath: z.string().nullable(),
  fileName: z.string().nullable(),
  fileSizeBytes: z.number().int().nullable(),
  uploadedByUserId: z.string(),
  publishedAt: z.coerce.date().nullable(),
  scheduledPublishAt: z.coerce.date().nullable(),
  expiresAt: z.coerce.date().nullable(),
  isVisibleToStudents: z.boolean(),
  restrictedToStudentIds: z.array(z.string()).nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  deletedAt: z.coerce.date().nullable(),
});

const ProgressSchema = z.object({
  id: uuidParam,
  schoolId: uuidParam,
  classId: uuidParam,
  studentId: uuidParam,
  lessonId: uuidParam,
  completedAt: z.coerce.date().nullable(),
  bookmarkedAt: z.coerce.date().nullable(),
});

const ResourcesPageSchema = z.object({
  resources: z.array(ResourceSchema),
  total: z.number().int(),
  page: z.number().int(),
  limit: z.number().int(),
});

const ActivitySchema = z.object({
  activities: z.array(
    z.object({
      studentId: uuidParam,
      studentName: z.string(),
      resourceId: uuidParam,
      resourceTitle: z.string(),
      accessedAt: z.coerce.date(),
      downloaded: z.boolean(),
    }),
  ),
  total: z.number().int(),
});

const MyClassroomsSchema = z.array(
  z.object({
    classId: uuidParam,
    className: z.string(),
    grade: z.string(),
    stream: z.string().nullable(),
    teacherName: z.string(),
  }),
);

const LessonDetailsSchema = z.object({
  lesson: LessonSchema,
  resources: z.array(ResourceSchema),
  progress: ProgressSchema.nullable(),
});

const BookmarkResponse = z.object({ bookmarked: z.boolean() });
const MarkCompleteResponse = z.object({ lessonComplete: z.boolean() });

export function classroomRoutes(deps: AppDeps): Router {
  const router = Router();
  const { database } = deps;

  // Student: my classrooms (registered before any :classId routes)
  router.get("/classrooms/my-classrooms", async (req, res) => {
    send(res, MyClassroomsSchema, await inSchool(database, req, res, ANY_MEMBER,
      (tx, ctx) => getMyClassrooms(tx, ctx.schoolId, ctx.userId),
    ));
  });

  // Teacher: create lesson in a class
  router.post("/classrooms/:classId/lessons", async (req, res) => {
    const input = parseInput(CreateLessonBody, req.body);
    const { classId } = parseInput(classIdParam, req.params);
    send(res, LessonSchema, await inSchool(database, req, res, MANAGE_ACCESS,
      (tx, ctx) => createLesson(tx, ctx, classId, input),
    ), 201);
  });

  // Teacher: create learning resource
  router.post("/classrooms/:classId/resources", async (req, res) => {
    const input = parseInput(CreateResourceBody, req.body);
    const { classId } = parseInput(classIdParam, req.params);
    send(res, ResourceSchema, await inSchool(database, req, res, MANAGE_ACCESS,
      (tx, ctx) => createLearningResource(tx, ctx, classId, input, currentUserId(res)),
    ), 201);
  });

  // Teacher: list resources for a class
  router.get("/classrooms/:classId/resources", async (req, res) => {
    const { classId } = parseInput(classIdParam, req.params);
    const query = parseInput(PageQuery, req.query);
    send(res, ResourcesPageSchema, await inSchool(database, req, res, MANAGE_ACCESS,
      (tx, ctx) => listLearningResources(tx, ctx, classId, query),
    ));
  });

  // Teacher: student activity for a class
  router.get("/classrooms/:classId/student-activity", async (req, res) => {
    const { classId } = parseInput(classIdParam, req.params);
    const query = parseInput(PageQuery, req.query);
    send(res, ActivitySchema, await inSchool(database, req, res, MANAGE_ACCESS,
      (tx, ctx) => getStudentActivityForClass(tx, ctx, classId, query.page, query.limit),
    ));
  });

  // Teacher: update resource metadata
  router.patch("/classrooms/:classId/resources/:resourceId", async (req, res) => {
    const input = parseInput(UpdateResourceBody, req.body);
    const { classId, resourceId } = parseInput(resourceParams, req.params);
    send(res, ResourceSchema, await inSchool(database, req, res, MANAGE_ACCESS,
      (tx, ctx) => updateLearningResource(tx, ctx, classId, resourceId, input),
    ));
  });

  // Teacher: publish resource (immediate or scheduled)
  router.post("/classrooms/:classId/resources/:resourceId/publish", async (req, res) => {
    const input = parseInput(PublishResourceBody, req.body);
    const { classId, resourceId } = parseInput(resourceParams, req.params);
    send(res, ResourceSchema, await inSchool(database, req, res, MANAGE_ACCESS,
      (tx, ctx) => publishResource(tx, ctx, classId, resourceId, {
        publishImmediately: input.publishImmediately,
        scheduledPublishAt: input.scheduledPublishAt?.toISOString(),
        expiresAt: input.expiresAt?.toISOString(),
        restrictedToStudentIds: input.restrictedToStudentIds,
      }),
    ));
  });

  // Teacher: soft-delete resource
  router.delete("/classrooms/:classId/resources/:resourceId", async (req, res) => {
    const { classId, resourceId } = parseInput(resourceParams, req.params);
    await inSchool(database, req, res, MANAGE_ACCESS,
      (tx, ctx) => updateLearningResource(tx, ctx, classId, resourceId, { deletedAt: new Date() }),
    );
    res.sendStatus(204);
  });

  // Student: lesson details with visible resources
  router.get("/classrooms/:classId/lessons/:lessonId", async (req, res) => {
    const { classId, lessonId } = parseInput(lessonParams, req.params);
    send(res, LessonDetailsSchema, await inSchool(database, req, res, ANY_MEMBER,
      (tx, ctx) => getLessonDetails(tx, classId, lessonId, ctx.userId),
    ));
  });

  // Student: resource details
  router.get("/classrooms/:classId/resources/:resourceId", async (req, res) => {
    const { classId, resourceId } = parseInput(resourceParams, req.params);
    send(res, ResourceSchema, await inSchool(database, req, res, ANY_MEMBER,
      (tx, ctx) => getResourceDetails(tx, classId, resourceId, ctx.userId),
    ));
  });

  // Student: download resource (logs access)
  router.get("/classrooms/:classId/resources/:resourceId/download", async (req, res) => {
    const { classId, resourceId } = parseInput(resourceParams, req.params);
    send(res, ResourceSchema, await inSchool(database, req, res, ANY_MEMBER,
      (tx, ctx) => getResourceDetails(tx, classId, resourceId, ctx.userId, { logAccess: true, logDownload: true }),
    ));
  });

  // Student: bookmark resource
  router.post("/classrooms/:classId/resources/:resourceId/bookmark", async (req, res) => {
    const input = parseInput(BookmarkBody, req.body);
    const { classId, resourceId } = parseInput(resourceParams, req.params);
    send(res, BookmarkResponse, await inSchool(database, req, res, ANY_MEMBER,
      (tx, ctx) => bookmarkResource(tx, classId, resourceId, ctx.userId, input.bookmark),
    ));
  });

  // Student: mark lesson complete
  router.post("/classrooms/:classId/lessons/:lessonId/mark-complete", async (req, res) => {
    const input = parseInput(MarkCompleteBody, req.body);
    const { classId, lessonId } = parseInput(lessonParams, req.params);
    send(res, MarkCompleteResponse, await inSchool(database, req, res, ANY_MEMBER,
      (tx, ctx) => markLessonComplete(tx, classId, lessonId, ctx.userId, input.completed),
    ));
  });

  return router;
}