import { Router, type Response } from "express";
import { and, asc, eq, desc, gte, lt, lte, isNull, or, inArray, sql } from "drizzle-orm";
import {
  learningResourcesTable,
  studentLearningProgressTable,
  classLessonsTable,
  studentsTable,
  classesTable,
  academicYearsTable,
  termsTable,
  userProfilesTable,
  resourceAccessLogsTable,
} from "@workspace/db/schema";
import type { LearningResource, StoredAttachment } from "@workspace/db/schema";
import {
  ListLearningResourcesQueryParams,
  ListLearningResourcesResponse,
  CreateLearningResourceBody,
  CreateLearningResourceResponse,
  ListRecentResourcesQueryParams,
  ListRecentResourcesResponse,
  GetLearningResourceParams,
  GetLearningResourceResponse,
  DownloadLearningResourceParams,
  DownloadLearningResourceResponse,
  ToggleBookmarkParams,
  ToggleBookmarkResponse,
  ListBookmarkedResourcesQueryParams,
  ListBookmarkedResourcesResponse,
  ListClassLessonsParams,
  ListClassLessonsResponse,
  CreateResourceUploadTargetsBody,
  CreateResourceUploadTargetsResponse,
  ListTeachableSubjectsQueryParams,
  ListTeachableSubjectsResponse,
  ListManagedLearningResourcesQueryParams,
  ListManagedLearningResourcesResponse,
  UpdateLearningResourceParams,
  UpdateLearningResourceBody,
  UpdateLearningResourceResponse,
  DeleteLearningResourceParams,
  PublishLearningResourceParams,
  PublishLearningResourceBody,
  PublishLearningResourceResponse,
  DownloadResourceFileParams,
  DownloadResourceFileResponse,
  PreviewResourceFileParams,
  PreviewResourceFileResponse,
} from "@workspace/api-zod";
import { inSchool, send, sendNoContent, currentUserId } from "../../lib/context";
import type { Tx } from "../../lib/database";
import type { AppDeps } from "../../lib/deps";
import { parseInput, badRequest, forbidden, notFound } from "../../lib/errors";
import { ANY_MEMBER, CLASSROOM_MANAGERS } from "../../lib/roles";
import {
  ALLOWED_FILE_EXTENSIONS,
  MAX_FILE_BYTES,
  extensionOf,
  resourceTypeForExtension,
} from "../../lib/storage";
import {
  assertCanManage,
  confirmStoredFiles,
  createUploadTargets,
  discard,
  findAttachment,
  requireStorage,
} from "./files";

const MANAGE_ACCESS = {
  roles: CLASSROOM_MANAGERS,
  capability: "classroom.manage",
  scopedRoles: ["teacher"],
} as const;

async function getStudent(
  tx: Tx,
  userId: string,
  schoolId: string,
): Promise<{ id: string; classId: string | null } | null> {
  const [student] = await tx
    .select({ id: studentsTable.id, classId: studentsTable.classId })
    .from(studentsTable)
    .where(
      and(
        eq(studentsTable.schoolId, schoolId),
        eq(studentsTable.authUserId, userId),
      ),
    );
  return student ?? null;
}

function visibleResourceConditions(now: Date) {
  return [
    eq(learningResourcesTable.isVisibleToStudents, true),
    isNull(learningResourcesTable.deletedAt),
    or(
      isNull(learningResourcesTable.publishedAt),
      lte(learningResourcesTable.publishedAt, now),
    ),
    or(
      isNull(learningResourcesTable.expiresAt),
      gte(learningResourcesTable.expiresAt, now),
    ),
  ];
}

function isVisibleToStudent(
  resource: LearningResource,
  studentId: string,
  now: Date,
): boolean {
  if (!resource.isVisibleToStudents || resource.deletedAt) return false;
  if (resource.publishedAt && resource.publishedAt > now) return false;
  if (resource.expiresAt && resource.expiresAt <= now) return false;
  const restricted = resource.restrictedToStudentIds ?? [];
  if (restricted.length > 0 && !restricted.includes(studentId)) return false;
  return true;
}

function resourceState(resource: LearningResource, now: Date) {
  if (resource.deletedAt) return "archived" as const;
  if (resource.expiresAt && resource.expiresAt <= now) return "expired" as const;
  if (resource.publishedAt) {
    return resource.publishedAt <= now ? ("published" as const) : ("scheduled" as const);
  }
  if (resource.scheduledPublishAt && resource.scheduledPublishAt > now) return "scheduled" as const;
  return "draft" as const;
}

/** Display names resolved in bulk so list views can show class, year, term and uploader. */
type ResourceExtras = {
  className: string | null;
  academicYear: string | null;
  term: string | null;
  uploadedBy: string | null;
};

async function loadExtras(
  tx: Tx,
  resources: LearningResource[],
): Promise<Map<string, ResourceExtras>> {
  const extras = new Map<string, ResourceExtras>();
  if (resources.length === 0) return extras;

  const classIds = [...new Set(resources.map((resource) => resource.classId))];
  const termIds = [...new Set(resources.map((resource) => resource.termId).filter((id): id is string => !!id))];
  const uploaderIds = [...new Set(resources.map((resource) => resource.uploadedByUserId))];

  const classes = await tx
    .select({
      id: classesTable.id,
      name: classesTable.name,
      academicYear: academicYearsTable.name,
    })
    .from(classesTable)
    .innerJoin(academicYearsTable, eq(academicYearsTable.id, classesTable.academicYearId))
    .where(inArray(classesTable.id, classIds));
  const classMap = new Map(classes.map((item) => [item.id, item]));

  const terms = termIds.length
    ? await tx
        .select({ id: termsTable.id, name: termsTable.name })
        .from(termsTable)
        .where(inArray(termsTable.id, termIds))
    : [];
  const termMap = new Map(terms.map((term) => [term.id, term.name]));

  const uploaders = await tx
    .select({ authUserId: userProfilesTable.authUserId, fullName: userProfilesTable.fullName })
    .from(userProfilesTable)
    .where(inArray(userProfilesTable.authUserId, uploaderIds));
  const uploaderMap = new Map(uploaders.map((user) => [user.authUserId, user.fullName]));

  for (const resource of resources) {
    const klass = classMap.get(resource.classId);
    extras.set(resource.id, {
      className: klass?.name ?? null,
      academicYear: klass?.academicYear ?? null,
      term: resource.termId ? termMap.get(resource.termId) ?? null : null,
      uploadedBy: uploaderMap.get(resource.uploadedByUserId) ?? null,
    });
  }
  return extras;
}

/** `uploadedAt` describes the record, because attachments live inside its JSONB column. */
function managedView(resource: LearningResource, now: Date, extras?: ResourceExtras) {
  return {
    id: resource.id,
    classId: resource.classId,
    className: extras?.className ?? null,
    title: resource.title,
    description: resource.description,
    subject: resource.subject,
    category: resource.category,
    resourceType: resource.resourceType,
    academicYear: extras?.academicYear ?? null,
    term: extras?.term ?? null,
    uploadedBy: extras?.uploadedBy ?? null,
    learningObjectives: resource.learningObjectives ?? [],
    lessonId: resource.lessonId,
    termId: resource.termId,
    state: resourceState(resource, now),
    publishedAt: resource.publishedAt,
    scheduledPublishAt: resource.scheduledPublishAt,
    expiresAt: resource.expiresAt,
    isVisibleToStudents: resource.isVisibleToStudents,
    restrictedToStudentIds: resource.restrictedToStudentIds ?? [],
    files: (resource.attachments ?? []).map((file) => ({ ...file, uploadedAt: resource.updatedAt })),
    createdAt: resource.createdAt,
    updatedAt: resource.updatedAt,
  };
}

function publicView(resource: LearningResource, extras?: ResourceExtras) {
  return {
    id: resource.id,
    title: resource.title,
    description: resource.description,
    resourceType: resource.resourceType,
    category: resource.category,
    subject: resource.subject,
    academicYear: extras?.academicYear ?? null,
    term: extras?.term ?? null,
    fileName: resource.fileName,
    fileSizeBytes: resource.fileSizeBytes,
    files: (resource.attachments ?? []).map((file) => ({ ...file, uploadedAt: resource.updatedAt })),
    publishedAt: resource.publishedAt,
    expiresAt: resource.expiresAt,
    createdAt: resource.createdAt,
  };
}

/** The legacy single-file columns describe the first confirmed attachment. */
function primaryFile(files: StoredAttachment[]) {
  const [first] = files;
  return { fileName: first?.name ?? null, fileSizeBytes: first?.size ?? null };
}

export function resourcesRouter(deps: AppDeps): Router {
  const router = Router();
  const { database } = deps;

  // POST /api/v1/learning/upload-targets — storage URLs, minted before any record exists
  router.post("/upload-targets", async (req, res) => {
    const body = parseInput(CreateResourceUploadTargetsBody, req.body);
    await inSchool(database, req, res, MANAGE_ACCESS, async (tx, ctx) => {
      await assertCanManage(tx, ctx.schoolId, body.classId);
      const storage = requireStorage(deps);
      const targets = await createUploadTargets(storage, {
        schoolId: ctx.schoolId,
        classId: body.classId,
        location: "resources",
      }, body.files);
      send(res, CreateResourceUploadTargetsResponse, {
        data: targets,
        maxFileBytes: MAX_FILE_BYTES,
        allowedTypes: ALLOWED_FILE_EXTENSIONS,
      }, 201);
    });
  });

  // GET /api/v1/learning/subject-options — subjects the caller may publish to
  router.get("/subject-options", async (req, res) => {
    const query = parseInput(ListTeachableSubjectsQueryParams, req.query);
    await inSchool(database, req, res, MANAGE_ACCESS, async (tx, ctx) => {
      const rows = await tx.execute<{ subject: string }>(sql`
        SELECT subject FROM (
          SELECT DISTINCT cta.subject AS subject FROM public.class_teacher_assignments cta
            WHERE cta.class_id = ${query.classId}::uuid AND cta.subject IS NOT NULL
          UNION
          SELECT DISTINCT a.subject FROM public.assignments a
            WHERE a.class_id = ${query.classId}::uuid
          UNION
          SELECT DISTINCT r.subject FROM public.learning_resources r
            WHERE r.class_id = ${query.classId}::uuid AND r.subject IS NOT NULL AND r.deleted_at IS NULL
        ) candidates
        WHERE app_private.has_school_role(
            ${ctx.schoolId}::uuid,
            ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[])
          OR app_private.has_school_capability(${ctx.schoolId}::uuid, 'classroom.manage')
          OR app_private.teaches_subject(${query.classId}::uuid, candidates.subject)
        ORDER BY subject
      `);
      send(res, ListTeachableSubjectsResponse, { data: rows.rows.map((row) => row.subject) });
    });
  });

  // GET /api/v1/learning/resources/management — the caller's managed list, drafts included.
  // Without a classId the row-level policies still scope teachers to their own classes and
  // subjects while administrators see every document filed in the school.
  router.get("/resources/management", async (req, res) => {
    const query = parseInput(ListManagedLearningResourcesQueryParams, req.query);
    await inSchool(database, req, res, MANAGE_ACCESS, async (tx, ctx) => {
      if (query.classId) await assertCanManage(tx, ctx.schoolId, query.classId);
      const now = new Date();
      const search = query.search?.trim();
      const rows = await tx
        .select()
        .from(learningResourcesTable)
        .where(
          and(
            eq(learningResourcesTable.schoolId, ctx.schoolId),
            query.classId ? eq(learningResourcesTable.classId, query.classId) : undefined,
            query.category ? eq(learningResourcesTable.category, query.category) : undefined,
            query.subject ? eq(learningResourcesTable.subject, query.subject) : undefined,
            query.termId ? eq(learningResourcesTable.termId, query.termId) : undefined,
            query.uploadedAfter
              ? gte(learningResourcesTable.createdAt, sql`${query.uploadedAfter}::date`)
              : undefined,
            query.uploadedBefore
              ? lt(learningResourcesTable.createdAt, sql`${query.uploadedBefore}::date + interval '1 day'`)
              : undefined,
            search
              ? sql`(title ILIKE ${"%" + search + "%"} OR description ILIKE ${"%" + search + "%"})`
              : undefined,
          ),
        )
        .orderBy(desc(learningResourcesTable.updatedAt));

      const extras = await loadExtras(tx, rows);
      const data = rows
        .map((row) => managedView(row, now, extras.get(row.id)))
        .filter((row) => !query.state || query.state === "all" || row.state === query.state);

      if (query.sort === "oldest") {
        data.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      } else if (query.sort === "title") {
        data.sort((a, b) => a.title.localeCompare(b.title));
      } else {
        data.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      }

      send(res, ListManagedLearningResourcesResponse, {
        data: data.slice(query.offset, query.offset + query.limit),
        total: data.length,
        storageEnabled: Boolean(deps.storage),
      });
    });
  });

  // GET /api/v1/learning/resources — visible resources for a class
  router.get("/resources", async (req, res) => {
    const query = parseInput(ListLearningResourcesQueryParams, req.query);

    await inSchool(database, req, res, ANY_MEMBER, async (tx, ctx) => {
      const student = await getStudent(tx, currentUserId(res), ctx.schoolId);

      let targetClassId = query.classId;
      if (student) {
        if (query.classId && query.classId !== student.classId) {
          throw forbidden("You can only view resources for your own class.");
        }
        targetClassId = student.classId ?? undefined;
      }
      if (!targetClassId) {
        throw badRequest(
          "Cannot determine class. Provide classId or enroll as student.",
          "no_class",
        );
      }

      const now = new Date();
      const conditions = [
        eq(learningResourcesTable.schoolId, ctx.schoolId),
        eq(learningResourcesTable.classId, targetClassId),
        ...visibleResourceConditions(now),
        query.resourceType
          ? eq(learningResourcesTable.resourceType, query.resourceType)
          : undefined,
        query.category ? eq(learningResourcesTable.category, query.category) : undefined,
        query.subject ? eq(learningResourcesTable.subject, query.subject) : undefined,
      ];

      const ordering =
        query.sort === "oldest"
          ? [asc(learningResourcesTable.publishedAt), asc(learningResourcesTable.createdAt)]
          : query.sort === "title"
            ? [asc(learningResourcesTable.title), desc(learningResourcesTable.publishedAt)]
            : [desc(learningResourcesTable.publishedAt), desc(learningResourcesTable.createdAt)];

      const resources = await tx
        .select()
        .from(learningResourcesTable)
        .where(and(...conditions))
        .orderBy(...ordering)
        .limit(query.limit)
        .offset(query.offset);

      const [countRow] = await tx
        .select({ count: sql<number>`cast(count(*) as int)` })
        .from(learningResourcesTable)
        .where(and(...conditions));
      const total = countRow?.count ?? 0;
      const extras = await loadExtras(tx, resources);

      send(res, ListLearningResourcesResponse, {
        data: resources.map((resource) => publicView(resource, extras.get(resource.id))),
        total,
        hasMore: query.offset + resources.length < total,
      });
    });
  });

  // GET /api/v1/learning/resources/recent — registered before /resources/:resourceId
  router.get("/resources/recent", async (req, res) => {
    const query = parseInput(ListRecentResourcesQueryParams, req.query);

    await inSchool(database, req, res, ANY_MEMBER, async (tx, ctx) => {
      const student = await getStudent(tx, currentUserId(res), ctx.schoolId);
      if (!student?.classId) {
        send(res, ListRecentResourcesResponse, { data: [] });
        return;
      }

      const resources = await tx
        .select()
        .from(learningResourcesTable)
        .where(
          and(
            eq(learningResourcesTable.schoolId, ctx.schoolId),
            eq(learningResourcesTable.classId, student.classId),
            ...visibleResourceConditions(new Date()),
          ),
        )
        .orderBy(desc(learningResourcesTable.publishedAt))
        .limit(query.limit);

      send(res, ListRecentResourcesResponse, {
        data: resources.map((r) => ({
          id: r.id,
          title: r.title,
          resourceType: r.resourceType,
          publishedAt: r.publishedAt,
        })),
      });
    });
  });

  // POST /api/v1/learning/resources/:resourceId/publish — draft ⇄ published ⇄ scheduled
  router.post("/resources/:resourceId/publish", async (req, res) => {
    const { resourceId } = parseInput(PublishLearningResourceParams, req.params);
    const input = parseInput(PublishLearningResourceBody, req.body);

    await inSchool(database, req, res, MANAGE_ACCESS, async (tx, ctx) => {
      const [resource] = await loadManaged(tx, ctx.schoolId, resourceId);
      const now = new Date();
      const values: Partial<LearningResource> = { updatedAt: now };

      if (input.state === "published") {
        values.publishedAt = resource.publishedAt ?? now;
        values.scheduledPublishAt = null;
        values.isVisibleToStudents = true;
      } else if (input.state === "scheduled") {
        const publishAt = input.publishAt ? new Date(input.publishAt) : null;
        if (!publishAt || publishAt <= now) {
          throw badRequest("Choose a future date and time to schedule publication.", "schedule_in_past");
        }
        values.publishedAt = null;
        values.scheduledPublishAt = publishAt;
        values.isVisibleToStudents = false;
      } else {
        values.publishedAt = null;
        values.scheduledPublishAt = null;
        values.isVisibleToStudents = false;
      }
      if (input.expiresAt !== undefined) values.expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
      if (input.restrictedToStudentIds) {
        await assertStudentsInClass(tx, resource.classId, input.restrictedToStudentIds);
        values.restrictedToStudentIds = input.restrictedToStudentIds;
      }

      const [updated] = await tx
        .update(learningResourcesTable)
        .set(values)
        .where(eq(learningResourcesTable.id, resourceId))
        .returning();

      if (input.state === "published" && resource.publishedAt === null) {
        await tx.execute(sql`
          SELECT app_private.notify_class(${ctx.schoolId}::uuid, ${resource.classId}::uuid,
            'resource.published', ${"New learning material"},
            ${`${updated.title} is now available in your digital classroom.`}::text,
            ${resourceId}::uuid)
        `);
      }

      const extras = await loadExtras(tx, [updated]);
      send(res, PublishLearningResourceResponse, managedView(updated, new Date(), extras.get(updated.id)));
    });
  });

  // PATCH /api/v1/learning/resources/:resourceId — edit metadata and replace files
  router.patch("/resources/:resourceId", async (req, res) => {
    const { resourceId } = parseInput(UpdateLearningResourceParams, req.params);
    const input = parseInput(UpdateLearningResourceBody, req.body);

    await inSchool(database, req, res, MANAGE_ACCESS, async (tx, ctx) => {
      const [resource] = await loadManaged(tx, ctx.schoolId, resourceId);

      let attachments = resource.attachments ?? [];
      if (input.files) {
        attachments = await confirmStoredFiles(requireStorage(deps), {
          schoolId: ctx.schoolId,
          classId: resource.classId,
          location: "resources",
        }, input.files);
      }

      const values: Partial<LearningResource> = { updatedAt: new Date() };
      if (input.title !== undefined) values.title = input.title.trim();
      if (input.description !== undefined) values.description = input.description.trim();
      if (input.subject !== undefined) values.subject = input.subject.trim();
      if (input.category !== undefined) values.category = input.category;
      if (input.learningObjectives !== undefined) values.learningObjectives = input.learningObjectives;
      if (input.lessonId !== undefined) {
        if (input.lessonId) await assertLessonInClass(tx, ctx.schoolId, resource.classId, input.lessonId);
        values.lessonId = input.lessonId;
      }
      if (input.termId !== undefined) {
        if (input.termId) await assertTermForClass(tx, ctx.schoolId, resource.classId, input.termId);
        values.termId = input.termId;
      }
      if (input.files) {
        values.attachments = attachments;
        const [first] = attachments;
        values.fileName = first?.name ?? null;
        values.fileSizeBytes = first?.size ?? null;
        values.filePath = first?.path ?? null;
        const derived = first ? resourceTypeForExtension(extensionOf(first.path)) : null;
        if (derived) values.resourceType = derived;
      }

      const [updated] = await tx
        .update(learningResourcesTable)
        .set(values)
        .where(eq(learningResourcesTable.id, resourceId))
        .returning();

      if (input.files) await discard(requireStorage(deps), attachments, resource.attachments ?? []);
      const extras = await loadExtras(tx, [updated]);
      send(res, UpdateLearningResourceResponse, managedView(updated, new Date(), extras.get(updated.id)));
    });
  });

  // DELETE /api/v1/learning/resources/:resourceId — archive so learners lose access
  router.delete("/resources/:resourceId", async (req, res) => {
    const { resourceId } = parseInput(DeleteLearningResourceParams, req.params);
    await inSchool(database, req, res, MANAGE_ACCESS, async (tx, ctx) => {
      const [resource] = await loadManaged(tx, ctx.schoolId, resourceId);
      // `deleted_at` alone hides the material: RLS and every learner query exclude it, and
      // learning_resources_publish_check ties the visibility flag to the publication time.
      await tx
        .update(learningResourcesTable)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(learningResourcesTable.id, resource.id));
      sendNoContent(res);
    });
  });

  // GET /api/v1/learning/resources/:resourceId — details + file metadata
  router.get("/resources/:resourceId", async (req, res) => {
    const { resourceId } = parseInput(GetLearningResourceParams, req.params);

    await inSchool(database, req, res, ANY_MEMBER, async (tx, ctx) => {
      const resource = await loadVisible(tx, ctx.schoolId, resourceId, res);
      const extras = await loadExtras(tx, [resource]);
      const extra = extras.get(resource.id);

      send(res, GetLearningResourceResponse, {
        id: resource.id,
        title: resource.title,
        description: resource.description,
        resourceType: resource.resourceType,
        category: resource.category,
        subject: resource.subject,
        academicYear: extra?.academicYear ?? null,
        term: extra?.term ?? null,
        learningObjectives: resource.learningObjectives,
        fileName: resource.fileName,
        fileSizeBytes: resource.fileSizeBytes,
        files: (resource.attachments ?? []).map((file) => ({ ...file, uploadedAt: resource.updatedAt })),
        publishedAt: resource.publishedAt,
        scheduledPublishAt: resource.scheduledPublishAt,
        expiresAt: resource.expiresAt,
        isVisibleToStudents: resource.isVisibleToStudents,
        createdAt: resource.createdAt,
        updatedAt: resource.updatedAt,
      });
    });
  });

  // GET /api/v1/learning/resources/:resourceId/files/:fileId/(download|preview)
  for (const mode of ["download", "preview"] as const) {
    router.get(
      `/resources/:resourceId/files/:fileId/${mode}`,
      async (req, res) => {
        const params = mode === "download"
          ? parseInput(DownloadResourceFileParams, req.params)
          : parseInput(PreviewResourceFileParams, req.params);
        const schema = mode === "download" ? DownloadResourceFileResponse : PreviewResourceFileResponse;

        await inSchool(database, req, res, ANY_MEMBER, async (tx, ctx) => {
          const resource = await loadVisible(tx, ctx.schoolId, params.resourceId, res);
          const file = findAttachment(resource.attachments ?? [], params.fileId);
          const grant = await requireStorage(deps).downloadGrant(file.path, file.name, {
            inline: mode === "preview",
          });
          if (mode === "download") await logAccess(tx, ctx.schoolId, resource.id, res, true);
          send(res, schema, grant);
        });
      },
    );
  }

  // GET /api/v1/learning/resources/:resourceId/download — the first attachment
  router.get("/resources/:resourceId/download", async (req, res) => {
    const { resourceId } = parseInput(DownloadLearningResourceParams, req.params);

    await inSchool(database, req, res, ANY_MEMBER, async (tx, ctx) => {
      const resource = await loadVisible(tx, ctx.schoolId, resourceId, res);
      const [file] = resource.attachments ?? [];
      if (!file) throw notFound("No file is attached to this material yet.");
      const grant = await requireStorage(deps).downloadGrant(file.path, file.name);
      await logAccess(tx, ctx.schoolId, resource.id, res, true);
      send(res, DownloadLearningResourceResponse, grant);
    });
  });

  // POST /api/v1/learning/resources — create resource (staff/teachers)
  router.post("/resources", async (req, res) => {
    const body = parseInput(CreateLearningResourceBody, req.body);

    await inSchool(database, req, res, MANAGE_ACCESS, async (tx, ctx) => {
      const [cls] = await tx
        .select({ id: classesTable.id, academicYearId: classesTable.academicYearId })
        .from(classesTable)
        .where(
          and(
            eq(classesTable.id, body.classId),
            eq(classesTable.schoolId, ctx.schoolId),
          ),
        );
      if (!cls) throw notFound("Class not found.");
      await assertCanManage(tx, ctx.schoolId, body.classId);

      if (body.lessonId) {
        await assertLessonInClass(tx, ctx.schoolId, body.classId, body.lessonId);
      }
      if (body.termId) {
        await assertTermForClass(tx, ctx.schoolId, body.classId, body.termId);
      }
      if (body.restrictedToStudentIds?.length) {
        await assertStudentsInClass(tx, body.classId, body.restrictedToStudentIds);
      }

      const files = body.files?.length
        ? await confirmStoredFiles(requireStorage(deps), {
            schoolId: ctx.schoolId,
            classId: body.classId,
            location: "resources",
          }, body.files)
        : [];

      const now = new Date();
      const publish = body.publish ?? (body.publishAt ? "scheduled" : "draft");
      let publishedAt: Date | null = null;
      let scheduledPublishAt: Date | null = null;
      if (publish === "published") publishedAt = now;
      if (publish === "scheduled") {
        const at = body.publishAt ? new Date(body.publishAt) : null;
        if (!at || at <= now) throw badRequest("Choose a future date and time to schedule publication.", "schedule_in_past");
        scheduledPublishAt = at;
      }
      const [first] = files;
      const derived = first ? resourceTypeForExtension(extensionOf(first.path)) : null;
      const primary = primaryFile(files);

      const [resource] = await tx
        .insert(learningResourcesTable)
        .values({
          schoolId: ctx.schoolId,
          classId: body.classId,
          lessonId: body.lessonId ?? null,
          termId: body.termId ?? null,
          title: body.title.trim(),
          description: body.description?.trim(),
          learningObjectives: body.learningObjectives ?? [],
          resourceType: derived ?? body.resourceType,
          category: body.category ?? "class_notes",
          subject: body.subject?.trim() ?? null,
          attachments: files,
          filePath: first?.path ?? null,
          uploadedByUserId: ctx.userId,
          publishedAt,
          scheduledPublishAt,
          expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
          isVisibleToStudents: publishedAt !== null,
          restrictedToStudentIds: body.restrictedToStudentIds ?? [],
          fileName: primary.fileName,
          fileSizeBytes: primary.fileSizeBytes,
        })
        .returning();

      send(
        res,
        CreateLearningResourceResponse,
        {
          id: resource.id,
          title: resource.title,
          resourceType: resource.resourceType,
          category: resource.category,
          isVisibleToStudents: resource.isVisibleToStudents,
          publishedAt: resource.publishedAt,
          files: (resource.attachments ?? []).map((file) => ({ ...file, uploadedAt: resource.updatedAt })),
          createdAt: resource.createdAt,
        },
        201,
      );
    });
  });

  // GET /api/v1/learning/bookmarks — resources on the learner's bookmarked lessons
  router.get("/bookmarks", async (req, res) => {
    const query = parseInput(ListBookmarkedResourcesQueryParams, req.query);

    await inSchool(database, req, res, ANY_MEMBER, async (tx, ctx) => {
      const student = await getStudent(tx, currentUserId(res), ctx.schoolId);
      if (!student) throw badRequest("User is not a student.", "not_a_student");

      const bookmarked = await tx
        .select({
          lessonId: studentLearningProgressTable.lessonId,
          bookmarkedAt: studentLearningProgressTable.bookmarkedAt,
        })
        .from(studentLearningProgressTable)
        .where(
          and(
            eq(studentLearningProgressTable.studentId, student.id),
            eq(studentLearningProgressTable.schoolId, ctx.schoolId),
          ),
        );

      const lessonIds = bookmarked
        .filter((b) => b.bookmarkedAt)
        .map((b) => b.lessonId);
      if (lessonIds.length === 0) {
        send(res, ListBookmarkedResourcesResponse, { data: [] });
        return;
      }

      const resources = await tx
        .select()
        .from(learningResourcesTable)
        .where(
          and(
            inArray(learningResourcesTable.lessonId, lessonIds),
            eq(learningResourcesTable.schoolId, ctx.schoolId),
            ...visibleResourceConditions(new Date()),
          ),
        )
        .limit(query.limit)
        .offset(query.offset);

      send(res, ListBookmarkedResourcesResponse, {
        data: resources.map((r) => ({
          id: r.id,
          title: r.title,
          resourceType: r.resourceType,
          description: r.description,
          bookmarkedAt:
            bookmarked.find((b) => b.lessonId === r.lessonId)?.bookmarkedAt ??
            null,
        })),
      });
    });
  });

  // POST /api/v1/learning/resources/:resourceId/bookmark — toggle lesson bookmark
  router.post("/resources/:resourceId/bookmark", async (req, res) => {
    const { resourceId } = parseInput(ToggleBookmarkParams, req.params);

    await inSchool(database, req, res, ANY_MEMBER, async (tx, ctx) => {
      const student = await getStudent(tx, currentUserId(res), ctx.schoolId);
      if (!student) throw badRequest("User is not a student.", "not_a_student");

      const [resource] = await tx
        .select()
        .from(learningResourcesTable)
        .where(
          and(
            eq(learningResourcesTable.id, resourceId),
            eq(learningResourcesTable.schoolId, ctx.schoolId),
            isNull(learningResourcesTable.deletedAt),
          ),
        );
      if (!resource || !resource.lessonId) {
        throw notFound("Resource or associated lesson not found.");
      }
      if (resource.classId !== student.classId) {
        throw notFound("Resource or associated lesson not found.");
      }

      const [existing] = await tx
        .select()
        .from(studentLearningProgressTable)
        .where(
          and(
            eq(studentLearningProgressTable.studentId, student.id),
            eq(studentLearningProgressTable.lessonId, resource.lessonId),
            eq(studentLearningProgressTable.schoolId, ctx.schoolId),
          ),
        );

      if (existing) {
        const toggledAt = existing.bookmarkedAt ? null : new Date();
        await tx
          .update(studentLearningProgressTable)
          .set({ bookmarkedAt: toggledAt })
          .where(eq(studentLearningProgressTable.id, existing.id));
        send(res, ToggleBookmarkResponse, { bookmarked: toggledAt !== null });
      } else {
        await tx.insert(studentLearningProgressTable).values({
          schoolId: ctx.schoolId,
          classId: resource.classId,
          studentId: student.id,
          lessonId: resource.lessonId,
          bookmarkedAt: new Date(),
        });
        send(res, ToggleBookmarkResponse, { bookmarked: true });
      }
    });
  });

  // GET /api/v1/learning/lessons/:classId — lessons grouped by unit/chapter
  router.get("/lessons/:classId", async (req, res) => {
    const { classId } = parseInput(ListClassLessonsParams, req.params);

    await inSchool(database, req, res, ANY_MEMBER, async (tx, ctx) => {
      const [cls] = await tx
        .select({ id: classesTable.id })
        .from(classesTable)
        .where(
          and(
            eq(classesTable.id, classId),
            eq(classesTable.schoolId, ctx.schoolId),
          ),
        );
      if (!cls) throw notFound("Class not found.");

      const student = await getStudent(tx, currentUserId(res), ctx.schoolId);
      if (student && student.classId !== classId) {
        throw notFound("Class not found.");
      }

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

      const grouped = new Map<string, Map<string, Array<{ id: string; name: string; topic: string | null }>>>();
      for (const lesson of lessons) {
        const unit = lesson.unit || "General";
        const chapter = lesson.chapter || "General";
        if (!grouped.has(unit)) grouped.set(unit, new Map());
        const chapters = grouped.get(unit)!;
        if (!chapters.has(chapter)) chapters.set(chapter, []);
        chapters.get(chapter)!.push({
          id: lesson.id,
          name: lesson.lessonName,
          topic: lesson.topic,
        });
      }

      send(res, ListClassLessonsResponse, {
        data: [...grouped.entries()].map(([unit, chapters]) => ({
          unit,
          chapters: [...chapters.entries()].map(([chapter, items]) => ({
            chapter,
            lessons: items,
          })),
        })),
      });
    });
  });

  async function loadManaged(tx: Tx, schoolId: string, resourceId: string) {
    const [resource] = await tx
      .select()
      .from(learningResourcesTable)
      .where(
        and(
          eq(learningResourcesTable.id, resourceId),
          eq(learningResourcesTable.schoolId, schoolId),
        ),
      );
    if (!resource) throw notFound("Resource not found.");
    await assertCanManage(tx, schoolId, resource.classId);
    return [resource];
  }

  async function loadVisible(tx: Tx, schoolId: string, resourceId: string, res: Response) {
    const [resource] = await tx
      .select()
      .from(learningResourcesTable)
      .where(
        and(
          eq(learningResourcesTable.id, resourceId),
          eq(learningResourcesTable.schoolId, schoolId),
          isNull(learningResourcesTable.deletedAt),
        ),
      );
    if (!resource) throw notFound("Resource not found.");

    const student = await getStudent(tx, currentUserId(res), schoolId);
    if (student && !isVisibleToStudent(resource, student.id, new Date())) {
      throw notFound("Resource not found.");
    }
    return resource;
  }

  async function logAccess(tx: Tx, schoolId: string, resourceId: string, res: Response, wasDownloaded: boolean) {
    const student = await getStudent(tx, currentUserId(res), schoolId);
    if (!student) return;
    await tx.insert(resourceAccessLogsTable).values({ schoolId, resourceId, studentId: student.id, wasDownloaded });
  }

  /** A term only fits a material when it belongs to the class's own academic year. */
  async function assertTermForClass(tx: Tx, schoolId: string, classId: string, termId: string) {
    const [row] = await tx
      .select({ academicYearId: termsTable.academicYearId })
      .from(termsTable)
      .innerJoin(classesTable, eq(classesTable.academicYearId, termsTable.academicYearId))
      .where(
        and(
          eq(termsTable.id, termId),
          eq(termsTable.schoolId, schoolId),
          eq(classesTable.id, classId),
          eq(classesTable.schoolId, schoolId),
        ),
      );
    if (!row) throw badRequest("That term does not belong to this class's academic year.", "invalid_term");
  }

  async function assertLessonInClass(tx: Tx, schoolId: string, classId: string, lessonId: string) {
    const [lesson] = await tx
      .select({ id: classLessonsTable.id })
      .from(classLessonsTable)
      .where(
        and(
          eq(classLessonsTable.id, lessonId),
          eq(classLessonsTable.classId, classId),
          eq(classLessonsTable.schoolId, schoolId),
        ),
      );
    if (!lesson) throw notFound("Lesson not found in this class.");
  }

  async function assertStudentsInClass(tx: Tx, classId: string, studentIds: string[]) {
    const [row] = await tx
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(studentsTable)
      .where(and(inArray(studentsTable.id, studentIds), eq(studentsTable.classId, classId)));
    if ((row?.count ?? 0) !== new Set(studentIds).size) {
      throw badRequest("Learner restrictions must belong to the same class.", "invalid_restriction");
    }
  }

  return router;
}

export default resourcesRouter;
