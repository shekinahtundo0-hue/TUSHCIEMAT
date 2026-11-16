import { Router } from "express";
import {
  CreateLessonBody,
  CreateLessonResponse,
  CreateLearningResourceBody,
  CreateLearningResourceResponse,
  ListLearningResourcesResponse,
  UpdateLearningResourceBody,
  UpdateLearningResourceResponse,
  PublishResourceBody,
  PublishResourceResponse,
  ListStudentActivityResponse,
  BookmarkResourceBody,
  BookmarkResourceResponse,
  MarkLessonCompleteBody,
  MarkLessonCompleteResponse,
  ListMyClassroomsResponse,
  GetLessonDetailsResponse,
  GetResourceDetailsResponse,
} from "@workspace/api-zod";
import { currentUserId, inSchool, send } from "../../lib/context";
import type { AppDeps } from "../../lib/deps";
import { forbidden, parseInput } from "../../lib/errors";
import { STAFF, STUDENT_VIEWERS } from "../../lib/roles";
import { currentProfile } from "../../middlewares/authenticate";
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

export function classroomRoutes(deps: AppDeps): Router {
  const router = Router();
  const { database } = deps;

  // Teacher: Create lesson in a class
  router.post("/classrooms/:classId/lessons", async (req, res) => {
    const input = parseInput(CreateLessonBody.strict(), req.body);
    const classId = req.params.classId;
    send(res, CreateLessonResponse, await inSchool(database, req, res,
      { roles: STAFF, capability: "resources.manage" },
      (tx, ctx) => createLesson(tx, ctx, classId, input),
    ), 201);
  });

  // Teacher: Create learning resource
  router.post("/classrooms/:classId/resources", async (req, res) => {
    const input = parseInput(CreateLearningResourceBody.strict(), req.body);
    const classId = req.params.classId;
    send(res, CreateLearningResourceResponse, await inSchool(database, req, res,
      { roles: STAFF, capability: "resources.manage" },
      (tx, ctx) => createLearningResource(tx, ctx, classId, input, currentUserId(res)),
    ), 201);
  });

  // Teacher: List resources for a class
  router.get("/classrooms/:classId/resources", async (req, res) => {
    const classId = req.params.classId;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const lessonId = req.query.lessonId as string | undefined;
    const resourceType = req.query.resourceType as string | undefined;
    
    send(res, ListLearningResourcesResponse, await inSchool(database, req, res,
      STAFF,
      (tx, ctx) => listLearningResources(tx, ctx, classId, { page, limit, lessonId, resourceType }),
    ));
  });

  // Teacher: Update resource metadata
  router.patch("/classrooms/:classId/resources/:resourceId", async (req, res) => {
    const input = parseInput(UpdateLearningResourceBody.strict(), req.body);
    const { classId, resourceId } = req.params;
    send(res, UpdateLearningResourceResponse, await inSchool(database, req, res,
      { roles: STAFF, capability: "resources.manage" },
      (tx, ctx) => updateLearningResource(tx, ctx, classId, resourceId, input),
    ));
  });

  // Teacher: Publish resource (immediate or schedule)
  router.post("/classrooms/:classId/resources/:resourceId/publish", async (req, res) => {
    const input = parseInput(PublishResourceBody.strict(), req.body);
    const { classId, resourceId } = req.params;
    send(res, PublishResourceResponse, await inSchool(database, req, res,
      { roles: STAFF, capability: "resources.manage" },
      (tx, ctx) => publishResource(tx, ctx, classId, resourceId, input),
    ));
  });

  // Teacher: Delete/archive resource
  router.delete("/classrooms/:classId/resources/:resourceId", async (req, res) => {
    const { classId, resourceId } = req.params;
    await inSchool(database, req, res,
      { roles: STAFF, capability: "resources.manage" },
      (tx, ctx) => updateLearningResource(tx, ctx, classId, resourceId, { deletedAt: new Date().toISOString() }),
    );
    res.sendStatus(204);
  });

  // Teacher: Get student activity for class
  router.get("/classrooms/:classId/student-activity", async (req, res) => {
    const classId = req.params.classId;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    
    send(res, ListStudentActivityResponse, await inSchool(database, req, res,
      STAFF,
      (tx, ctx) => getStudentActivityForClass(tx, ctx, classId, page, limit),
    ));
  });

  // Student: Get my classrooms
  router.get("/classrooms/my-classrooms", async (req, res) => {
    const profile = currentProfile(res);
    const schoolId = req.headers["x-school-id"] as string;
    if (!schoolId) throw forbidden("X-School-Id header required");
    
    send(res, ListMyClassroomsResponse, await database.asUser(profile.authUserId,
      (tx) => getMyClassrooms(tx, schoolId, profile.authUserId),
    ));
  });

  // Student: Get lesson details with resources
  router.get("/classrooms/:classId/lessons/:lessonId", async (req, res) => {
    const { classId, lessonId } = req.params;
    const profile = currentProfile(res);
    
    send(res, GetLessonDetailsResponse, await database.asUser(profile.authUserId,
      (tx) => getLessonDetails(tx, classId, lessonId, profile.authUserId),
    ));
  });

  // Student: Get resource details
  router.get("/classrooms/:classId/resources/:resourceId", async (req, res) => {
    const { classId, resourceId } = req.params;
    const profile = currentProfile(res);
    
    send(res, GetResourceDetailsResponse, await database.asUser(profile.authUserId,
      (tx) => getResourceDetails(tx, classId, resourceId, profile.authUserId),
    ));
  });

  // Student: Download resource (with access logging)
  router.get("/classrooms/:classId/resources/:resourceId/download", async (req, res) => {
    const { classId, resourceId } = req.params;
    const profile = currentProfile(res);
    
    // Service will return download URL and log access
    const response = await database.asUser(profile.authUserId,
      (tx) => getResourceDetails(tx, classId, resourceId, profile.authUserId, { logAccess: true, logDownload: true }),
    );
    
    send(res, GetResourceDetailsResponse, response);
  });

  // Student: Bookmark resource
  router.post("/classrooms/:classId/resources/:resourceId/bookmark", async (req, res) => {
    const input = parseInput(BookmarkResourceBody.strict(), req.body);
    const { classId, resourceId } = req.params;
    const profile = currentProfile(res);
    
    send(res, BookmarkResourceResponse, await database.asUser(profile.authUserId,
      (tx) => bookmarkResource(tx, classId, resourceId, profile.authUserId, input.bookmark),
    ));
  });

  // Student: Mark lesson complete
  router.post("/classrooms/:classId/lessons/:lessonId/mark-complete", async (req, res) => {
    const input = parseInput(MarkLessonCompleteBody.strict(), req.body);
    const { classId, lessonId } = req.params;
    const profile = currentProfile(res);
    
    send(res, MarkLessonCompleteResponse, await database.asUser(profile.authUserId,
      (tx) => markLessonComplete(tx, classId, lessonId, profile.authUserId, input.completed),
    ));
  });

  return router;
}
