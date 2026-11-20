import { Router } from "express";
import { and, eq, desc, inArray, sql } from "drizzle-orm";
import {
  assignmentsTable,
  assignmentSubmissionsTable,
  studentsTable,
  classesTable,
} from "@workspace/db/schema";
import type {
  Assignment,
  AssignmentSubmission,
  AssignmentSubmissionStatus,
  StoredAttachment,
} from "@workspace/db/schema";
import {
  ListAssignmentsQueryParams,
  ListAssignmentsResponse,
  CreateAssignmentBody,
  CreateAssignmentResponse,
  GetAssignmentDetailParams,
  GetAssignmentDetailResponse,
  UpdateAssignmentParams,
  UpdateAssignmentBody,
  UpdateAssignmentResponse,
  SubmitAssignmentParams,
  SubmitAssignmentBody,
  SubmitAssignmentResponse,
  UpdateAssignmentSubmissionParams,
  UpdateAssignmentSubmissionBody,
  UpdateAssignmentSubmissionResponse,
  GetAssignmentSubmissionParams,
  GetAssignmentSubmissionResponse,
  ListAssignmentSubmissionsParams,
  ListAssignmentSubmissionsQueryParams,
  ListAssignmentSubmissionsResponse,
  MarkAssignmentSubmissionParams,
  MarkAssignmentSubmissionBody,
  MarkAssignmentSubmissionResponse,
  CreateAssignmentUploadTargetsBody,
  CreateAssignmentUploadTargetsResponse,
  CreateSubmissionUploadTargetsParams,
  CreateSubmissionUploadTargetsBody,
  CreateSubmissionUploadTargetsResponse,
  ListManagedAssignmentsQueryParams,
  ListManagedAssignmentsResponse,
  DownloadAssignmentFileParams,
  DownloadAssignmentFileResponse,
  PublishAssignmentParams,
  PublishAssignmentBody,
  PublishAssignmentResponse,
  DuplicateAssignmentParams,
  DuplicateAssignmentResponse,
  ExtendAssignmentDeadlineParams,
  ExtendAssignmentDeadlineBody,
  ExtendAssignmentDeadlineResponse,
  SetAssignmentStateParams,
  SetAssignmentStateBody,
  SetAssignmentStateResponse,
  DownloadSubmissionFileParams,
  DownloadSubmissionFileResponse,
} from "@workspace/api-zod";
import { inSchool, send, currentUserId } from "../../lib/context";
import type { Tx } from "../../lib/database";
import type { AppDeps } from "../../lib/deps";
import { badRequest, conflict, notFound, parseInput } from "../../lib/errors";
import { ANY_MEMBER, CLASSROOM_MANAGERS } from "../../lib/roles";
import { ALLOWED_FILE_EXTENSIONS, MAX_FILE_BYTES, extensionOf } from "../../lib/storage";
import {
  assertCanManage,
  confirmStoredFiles,
  createUploadTargets,
  findAttachment,
  requireStorage,
} from "../classroom/files";

const MANAGE_ACCESS = {
  roles: CLASSROOM_MANAGERS,
  capability: "classroom.manage",
  scopedRoles: ["teacher"],
} as const;

const MAX_REVISIONS = 10;

async function getStudent(tx: Tx, userId: string, schoolId: string) {
  const [student] = await tx
    .select({ id: studentsTable.id, classId: studentsTable.classId })
    .from(studentsTable)
    .where(
      and(eq(studentsTable.schoolId, schoolId), eq(studentsTable.authUserId, userId)),
    );
  return student ?? null;
}

function deadlineOf(assignment: Assignment): Date {
  return new Date(`${assignment.deadlineDate}T${assignment.deadlineTime || "23:59:59"}`);
}

function calculateSubmissionStatus(
  assignment: Assignment,
  submission: AssignmentSubmission | null | undefined,
  now: Date,
): AssignmentSubmissionStatus {
  if (!submission || !submission.submittedAt) {
    if (now > deadlineOf(assignment)) return "overdue";
    return submission ? "in_progress" : "not_started";
  }
  return submission.marksObtained !== null ? "graded" : "submitted";
}

/** A scheduled assignment reads as published the moment its publication time arrives. */
function lifecycleState(assignment: Assignment, now: Date): Assignment["status"] {
  if (assignment.status === "scheduled" && assignment.publishedAt && assignment.publishedAt <= now) {
    return "published";
  }
  return assignment.status;
}

function filesOf(files: StoredAttachment[], at: Date) {
  return (files ?? []).map((file) => ({ ...file, uploadedAt: at }));
}

function submissionView(submission: AssignmentSubmission) {
  return {
    id: submission.id,
    submissionText: submission.submissionText,
    submittedFiles: filesOf(submission.submittedFiles, submission.updatedAt),
    submittedAt: submission.submittedAt,
    marksObtained: submission.marksObtained !== null ? parseFloat(submission.marksObtained) : null,
    feedback: submission.feedback,
    markedAt: submission.markedAt,
    status: submission.status,
    isLate: submission.isLate,
  };
}

function managedView(assignment: Assignment, now: Date, submissionCount = 0, gradedCount = 0) {
  return {
    id: assignment.id,
    classId: assignment.classId,
    subject: assignment.subject,
    title: assignment.title,
    description: assignment.description,
    instructions: assignment.instructions,
    attachedResourceIds: assignment.attachedResourceIds,
    assignmentKind: assignment.assignmentKind,
    topic: assignment.topic,
    marksAllocated: assignment.marksAllocated,
    deadlineDate: assignment.deadlineDate,
    deadlineTime: assignment.deadlineTime,
    allowResubmission: assignment.allowResubmission,
    allowLate: assignment.allowLate,
    allowedFileTypes: assignment.allowedFileTypes ?? [],
    state: lifecycleState(assignment, now),
    publishedAt: assignment.publishedAt,
    archivedAt: assignment.archivedAt,
    files: filesOf(assignment.attachments, assignment.updatedAt),
    submissionCount,
    gradedCount,
    createdAt: assignment.createdAt,
    updatedAt: assignment.updatedAt,
  };
}

function assertAllowedType(allowed: string[], file: { path: string; name: string }) {
  if (allowed.length === 0) return;
  if (!allowed.map((type) => type.toLowerCase()).includes(extensionOf(file.path))) {
    throw badRequest(
      `"${file.name}" is not an allowed format for this assignment.`,
      "unsupported_file_type",
    );
  }
}

export function assignmentsRouter(deps: AppDeps): Router {
  const router = Router();
  const { database } = deps;

  // POST /api/v1/assignments/upload-targets — supporting files for a new assignment
  router.post("/upload-targets", async (req, res) => {
    const body = parseInput(CreateAssignmentUploadTargetsBody, req.body);
    await inSchool(database, req, res, MANAGE_ACCESS, async (tx, ctx) => {
      await assertCanManage(tx, ctx.schoolId, body.classId);
      const targets = await createUploadTargets(requireStorage(deps), {
        schoolId: ctx.schoolId,
        classId: body.classId,
        location: "assignments",
      }, body.files);
      send(res, CreateAssignmentUploadTargetsResponse, {
        data: targets,
        maxFileBytes: MAX_FILE_BYTES,
        allowedTypes: ALLOWED_FILE_EXTENSIONS,
      }, 201);
    });
  });

  // GET /api/v1/assignments/management — the teacher's assignments, drafts included
  router.get("/management", async (req, res) => {
    const query = parseInput(ListManagedAssignmentsQueryParams, req.query);
    await inSchool(database, req, res, MANAGE_ACCESS, async (tx, ctx) => {
      await assertCanManage(tx, ctx.schoolId, query.classId);
      const now = new Date();
      const assignments = await tx
        .select()
        .from(assignmentsTable)
        .where(
          and(
            eq(assignmentsTable.schoolId, ctx.schoolId),
            eq(assignmentsTable.classId, query.classId),
            query.subject ? eq(assignmentsTable.subject, query.subject) : undefined,
          ),
        )
        .orderBy(desc(assignmentsTable.createdAt));

      const counts = assignments.length
        ? await tx
            .select({
              assignmentId: assignmentSubmissionsTable.assignmentId,
              submitted: sql<number>`cast(count(*) filter (where ${assignmentSubmissionsTable.submittedAt} is not null) as int)`,
              graded: sql<number>`cast(count(*) filter (where ${assignmentSubmissionsTable.status} = 'graded') as int)`,
            })
            .from(assignmentSubmissionsTable)
            .where(inArray(assignmentSubmissionsTable.assignmentId, assignments.map((a) => a.id)))
            .groupBy(assignmentSubmissionsTable.assignmentId)
        : [];
      const countMap = new Map(counts.map((row) => [row.assignmentId, row]));

      const data = assignments
        .map((assignment) => {
          const row = countMap.get(assignment.id);
          return managedView(assignment, now, row?.submitted ?? 0, row?.graded ?? 0);
        })
        .filter((row) => !query.state || query.state === "all" || row.state === query.state);

      send(res, ListManagedAssignmentsResponse, {
        data: data.slice(query.offset, query.offset + query.limit),
        total: data.length,
        storageEnabled: Boolean(deps.storage),
      });
    });
  });

  router.get("/", async (req, res) => {
    const query = parseInput(ListAssignmentsQueryParams, req.query);

    await inSchool(database, req, res, ANY_MEMBER, async (tx, ctx) => {
      const student = await getStudent(tx, currentUserId(res), ctx.schoolId);
      if (!student) {
        throw badRequest("User is not a student in this school.", "not_a_student");
      }
      if (!student.classId) {
        throw badRequest("Student is not enrolled in a class.", "no_class");
      }

      const assignments = await tx
        .select()
        .from(assignmentsTable)
        .where(
          and(
            eq(assignmentsTable.schoolId, ctx.schoolId),
            eq(assignmentsTable.classId, student.classId),
            query.subject ? eq(assignmentsTable.subject, query.subject) : undefined,
          ),
        )
        .orderBy(desc(assignmentsTable.createdAt))
        .limit(query.limit)
        .offset(query.offset);

      const assignmentIds = assignments.map((a) => a.id);
      const submissions = assignmentIds.length
        ? await tx
            .select()
            .from(assignmentSubmissionsTable)
            .where(
              and(
                inArray(assignmentSubmissionsTable.assignmentId, assignmentIds),
                eq(assignmentSubmissionsTable.studentId, student.id),
              ),
            )
        : [];
      const submissionMap = new Map(submissions.map((s) => [s.assignmentId, s]));

      const now = new Date();
      let data = assignments.map((a) => ({
        id: a.id,
        classId: a.classId,
        subject: a.subject,
        title: a.title,
        description: a.description,
        deadlineDate: a.deadlineDate,
        deadlineTime: a.deadlineTime,
        marksAllocated: a.marksAllocated,
        assignmentKind: a.assignmentKind,
        allowLate: a.allowLate,
        status: calculateSubmissionStatus(a, submissionMap.get(a.id), now),
        createdAt: a.createdAt,
      }));
      if (query.status) {
        data = data.filter((a) => a.status === query.status);
      }

      send(res, ListAssignmentsResponse, { data, total: data.length, hasMore: false });
    });
  });

  // POST /api/v1/assignments — create as draft, publish now, or schedule
  router.post("/", async (req, res) => {
    const input = parseInput(CreateAssignmentBody, req.body);

    await inSchool(database, req, res, MANAGE_ACCESS, async (tx, ctx) => {
      const [cls] = await tx
        .select({ id: classesTable.id })
        .from(classesTable)
        .where(and(eq(classesTable.id, input.classId), eq(classesTable.schoolId, ctx.schoolId)));
      if (!cls) throw notFound("Class not found.");
      await assertCanManage(tx, ctx.schoolId, input.classId);

      const files = input.files?.length
        ? await confirmStoredFiles(requireStorage(deps), {
            schoolId: ctx.schoolId,
            classId: input.classId,
            location: "assignments",
          }, input.files)
        : [];
      const allowed = input.allowedFileTypes ?? [];
      files.forEach((file) => assertAllowedType(allowed, file));

      const now = new Date();
      const publish = input.publish ?? (input.publishAt ? "scheduled" : "published");
      let status: Assignment["status"] = "published";
      let publishedAt: Date | null = now;
      if (publish === "draft") {
        status = "draft";
        publishedAt = null;
      }
      if (publish === "scheduled") {
        const at = input.publishAt ? new Date(input.publishAt) : null;
        if (!at || at <= now) {
          throw badRequest("Choose a future date and time to schedule publication.", "schedule_in_past");
        }
        status = "scheduled";
        publishedAt = at;
      }

      const [assignment] = await tx
        .insert(assignmentsTable)
        .values({
          schoolId: ctx.schoolId,
          classId: input.classId,
          subject: input.subject.trim(),
          title: input.title.trim(),
          description: input.description?.trim(),
          instructions: input.instructions ?? [],
          attachedResourceIds: input.attachedResourceIds ?? [],
          marksAllocated: input.marksAllocated,
          deadlineDate: input.deadlineDate,
          deadlineTime: input.deadlineTime ?? null,
          allowResubmission: input.allowResubmission ?? false,
          status,
          assignmentKind: input.assignmentKind ?? "homework",
          topic: input.topic?.trim() ?? null,
          publishedAt,
          allowLate: input.allowLate ?? false,
          allowedFileTypes: allowed,
          attachments: files,
          createdByUserId: ctx.userId,
        })
        .returning();

      if (status === "published") {
        await notifyClass(tx, ctx.schoolId, assignment, assignment.id);
      }

      send(
        res,
        CreateAssignmentResponse,
        {
          id: assignment.id,
          classId: assignment.classId,
          subject: assignment.subject,
          title: assignment.title,
          marksAllocated: assignment.marksAllocated,
          deadlineDate: assignment.deadlineDate,
          createdAt: assignment.createdAt,
          state: lifecycleState(assignment, new Date()),
          publishedAt: assignment.publishedAt,
        },
        201,
      );
    });
  });

  // POST /api/v1/assignments/:assignmentId/publish
  router.post("/:assignmentId/publish", async (req, res) => {
    const { assignmentId } = parseInput(PublishAssignmentParams, req.params);
    const input = parseInput(PublishAssignmentBody, req.body);

    await inSchool(database, req, res, MANAGE_ACCESS, async (tx, ctx) => {
      const { assignment } = await loadManaged(tx, ctx, assignmentId);
      const now = new Date();
      const wasLive = assignment.status === "published" && assignment.publishedAt !== null;
      let status: Assignment["status"] = "draft";
      let publishedAt: Date | null = null;

      if (input.state === "published") {
        status = "published";
        publishedAt = assignment.publishedAt ?? now;
      } else if (input.state === "scheduled") {
        const at = input.publishAt ? new Date(input.publishAt) : null;
        if (!at || at <= now) {
          throw badRequest("Choose a future date and time to schedule publication.", "schedule_in_past");
        }
        status = "scheduled";
        publishedAt = at;
      }

      const [updated] = await tx
        .update(assignmentsTable)
        .set({ status, publishedAt, updatedAt: now })
        .where(eq(assignmentsTable.id, assignmentId))
        .returning();

      if (!wasLive && status === "published") await notifyClass(tx, ctx.schoolId, updated, updated.id);
      send(res, PublishAssignmentResponse, managedView(updated, new Date()));
    });
  });

  // POST /api/v1/assignments/:assignmentId/extend-deadline
  router.post("/:assignmentId/extend-deadline", async (req, res) => {
    const { assignmentId } = parseInput(ExtendAssignmentDeadlineParams, req.params);
    const input = parseInput(ExtendAssignmentDeadlineBody, req.body);

    await inSchool(database, req, res, MANAGE_ACCESS, async (tx, ctx) => {
      const { assignment } = await loadManaged(tx, ctx, assignmentId);
      const current = deadlineOf(assignment);
      const extended = new Date(`${input.deadlineDate}T${input.deadlineTime ?? "23:59:59"}`);
      if (extended <= current) {
        throw badRequest("A deadline extension must move the date later.", "deadline_not_extended");
      }

      const [updated] = await tx
        .update(assignmentsTable)
        .set({ deadlineDate: input.deadlineDate, deadlineTime: input.deadlineTime ?? assignment.deadlineTime, updatedAt: new Date() })
        .where(eq(assignmentsTable.id, assignmentId))
        .returning();

      await tx.execute(sql`
        SELECT app_private.notify_class(${ctx.schoolId}::uuid, ${updated.classId}::uuid,
          'assignment.deadline', ${`Deadline extended: ${updated.subject}`},
          ${`"${updated.title}" can now be submitted until ${input.deadlineDate}.`}::text,
          ${updated.id}::uuid)
      `);
      send(res, ExtendAssignmentDeadlineResponse, managedView(updated, new Date()));
    });
  });

  // POST /api/v1/assignments/:assignmentId/state — archive or cancel
  router.post("/:assignmentId/state", async (req, res) => {
    const { assignmentId } = parseInput(SetAssignmentStateParams, req.params);
    const input = parseInput(SetAssignmentStateBody, req.body);

    await inSchool(database, req, res, MANAGE_ACCESS, async (tx, ctx) => {
      const { assignment } = await loadManaged(tx, ctx, assignmentId);
      const [updated] = await tx
        .update(assignmentsTable)
        .set({
          status: input.state,
          archivedAt: input.state === "archived" ? new Date() : assignment.archivedAt,
          updatedAt: new Date(),
        })
        .where(eq(assignmentsTable.id, assignmentId))
        .returning();
      send(res, SetAssignmentStateResponse, managedView(updated, new Date()));
    });
  });

  // POST /api/v1/assignments/:assignmentId/duplicate — a fresh draft, files excluded
  router.post("/:assignmentId/duplicate", async (req, res) => {
    const { assignmentId } = parseInput(DuplicateAssignmentParams, req.params);

    await inSchool(database, req, res, MANAGE_ACCESS, async (tx, ctx) => {
      const { assignment } = await loadManaged(tx, ctx, assignmentId);
      const [copy] = await tx
        .insert(assignmentsTable)
        .values({
          schoolId: ctx.schoolId,
          classId: assignment.classId,
          subject: assignment.subject,
          title: `${assignment.title} (copy)`.slice(0, 200),
          description: assignment.description,
          instructions: assignment.instructions,
          attachedResourceIds: assignment.attachedResourceIds,
          marksAllocated: assignment.marksAllocated,
          deadlineDate: assignment.deadlineDate,
          deadlineTime: assignment.deadlineTime,
          allowResubmission: assignment.allowResubmission,
          status: "draft",
          assignmentKind: assignment.assignmentKind,
          topic: assignment.topic,
          publishedAt: null,
          allowLate: assignment.allowLate,
          allowedFileTypes: assignment.allowedFileTypes,
          attachments: [],
          createdByUserId: ctx.userId,
        })
        .returning();
      send(res, DuplicateAssignmentResponse, managedView(copy, new Date()), 201);
    });
  });

  router.get("/:assignmentId", async (req, res) => {
    const { assignmentId } = parseInput(GetAssignmentDetailParams, req.params);

    await inSchool(database, req, res, ANY_MEMBER, async (tx, ctx) => {
      const student = await getStudent(tx, currentUserId(res), ctx.schoolId);
      if (!student) {
        throw badRequest("User is not a student in this school.", "not_a_student");
      }

      const [assignment] = await tx
        .select()
        .from(assignmentsTable)
        .where(
          and(eq(assignmentsTable.id, assignmentId), eq(assignmentsTable.schoolId, ctx.schoolId)),
        );
      if (!assignment || assignment.classId !== student.classId) {
        throw notFound("Assignment not found.");
      }

      const [submission] = await tx
        .select()
        .from(assignmentSubmissionsTable)
        .where(
          and(
            eq(assignmentSubmissionsTable.assignmentId, assignmentId),
            eq(assignmentSubmissionsTable.studentId, student.id),
          ),
        );

      send(res, GetAssignmentDetailResponse, {
        id: assignment.id,
        subject: assignment.subject,
        title: assignment.title,
        description: assignment.description,
        instructions: assignment.instructions,
        attachedResourceIds: assignment.attachedResourceIds,
        assignmentKind: assignment.assignmentKind,
        topic: assignment.topic,
        marksAllocated: assignment.marksAllocated,
        deadlineDate: assignment.deadlineDate,
        deadlineTime: assignment.deadlineTime,
        allowResubmission: assignment.allowResubmission,
        allowLate: assignment.allowLate,
        allowedFileTypes: assignment.allowedFileTypes ?? [],
        state: lifecycleState(assignment, new Date()),
        createdAt: assignment.createdAt,
        files: filesOf(assignment.attachments, assignment.updatedAt),
        submission: submission ? submissionView(submission) : null,
        status: calculateSubmissionStatus(assignment, submission, new Date()),
      });
    });
  });

  // GET /api/v1/assignments/:assignmentId/files/:fileId/download — worksheet handout
  router.get("/:assignmentId/files/:fileId/download", async (req, res) => {
    const { assignmentId, fileId } = parseInput(DownloadAssignmentFileParams, req.params);

    await inSchool(database, req, res, ANY_MEMBER, async (tx, ctx) => {
      const [assignment] = await tx
        .select()
        .from(assignmentsTable)
        .where(and(eq(assignmentsTable.id, assignmentId), eq(assignmentsTable.schoolId, ctx.schoolId)));
      if (!assignment) throw notFound("Assignment not found.");
      const student = await getStudent(tx, currentUserId(res), ctx.schoolId);
      if (student && assignment.classId !== student.classId) throw notFound("Assignment not found.");

      const file = findAttachment(assignment.attachments ?? [], fileId);
      const grant = await requireStorage(deps).downloadGrant(file.path, file.name);
      send(res, DownloadAssignmentFileResponse, grant);
    });
  });

  // POST /api/v1/assignments/:assignmentId/submission/upload-targets — learner's own files
  router.post("/:assignmentId/submission/upload-targets", async (req, res) => {
    const { assignmentId } = parseInput(CreateSubmissionUploadTargetsParams, req.params);
    const body = parseInput(CreateSubmissionUploadTargetsBody, req.body);

    await inSchool(database, req, res, ANY_MEMBER, async (tx, ctx) => {
      const student = await getStudent(tx, currentUserId(res), ctx.schoolId);
      if (!student?.classId) throw badRequest("Student is not enrolled in a class.", "no_class");
      const [assignment] = await tx
        .select({ id: assignmentsTable.id, classId: assignmentsTable.classId, allowedFileTypes: assignmentsTable.allowedFileTypes })
        .from(assignmentsTable)
        .where(and(eq(assignmentsTable.id, assignmentId), eq(assignmentsTable.schoolId, ctx.schoolId)));
      if (!assignment || assignment.classId !== student.classId) throw notFound("Assignment not found.");

      const targets = await createUploadTargets(requireStorage(deps), {
        schoolId: ctx.schoolId,
        classId: assignment.classId,
        location: "submissions",
      }, body.files);
      targets.forEach((target) => assertAllowedType(assignment.allowedFileTypes ?? [], target));

      const restricted = assignment.allowedFileTypes ?? [];
      send(res, CreateSubmissionUploadTargetsResponse, {
        data: targets,
        maxFileBytes: MAX_FILE_BYTES,
        allowedTypes: restricted.length ? restricted : ALLOWED_FILE_EXTENSIONS,
      }, 201);
    });
  });

  // POST /api/v1/assignments/:assignmentId/submit
  router.post("/:assignmentId/submit", async (req, res) => {
    const { assignmentId } = parseInput(SubmitAssignmentParams, req.params);
    const input = parseInput(SubmitAssignmentBody, req.body);

    await inSchool(database, req, res, ANY_MEMBER, async (tx, ctx) => {
      const student = await getStudent(tx, currentUserId(res), ctx.schoolId);
      if (!student) {
        throw badRequest("User is not a student in this school.", "not_a_student");
      }

      const [assignment] = await tx
        .select()
        .from(assignmentsTable)
        .where(
          and(eq(assignmentsTable.id, assignmentId), eq(assignmentsTable.schoolId, ctx.schoolId)),
        );
      if (!assignment || assignment.classId !== student.classId) {
        throw notFound("Assignment not found.");
      }

      const now = new Date();
      const isLate = now > deadlineOf(assignment);
      if (isLate && !assignment.allowLate) {
        throw badRequest("Assignment deadline has passed.", "deadline_exceeded");
      }
      if (lifecycleState(assignment, now) !== "published") {
        throw badRequest("This assignment is not open for submissions.", "submission_closed");
      }

      const [existing] = await tx
        .select()
        .from(assignmentSubmissionsTable)
        .where(
          and(
            eq(assignmentSubmissionsTable.assignmentId, assignmentId),
            eq(assignmentSubmissionsTable.studentId, student.id),
          ),
        );
      if (existing && (existing.status === "graded" || existing.marksObtained !== null
        || existing.markedAt !== null || existing.gradedByUserId !== null)) {
        throw badRequest("Graded submissions cannot be changed.", "submission_graded");
      }
      if (existing?.submittedAt && !assignment.allowResubmission) {
        throw conflict("Assignment already submitted. Resubmission is not allowed.");
      }

      // Omitting either part keeps the previous attempt's part, so a text-only resubmission
      // never silently drops work the learner already attached.
      const files = input.files?.length
        ? await confirmStoredFiles(requireStorage(deps), {
            schoolId: ctx.schoolId,
            classId: assignment.classId,
            location: "submissions",
          }, input.files)
        : (existing?.submittedFiles ?? []);
      files.forEach((file) => assertAllowedType(assignment.allowedFileTypes ?? [], file));

      const submissionText = input.submissionText ?? existing?.submissionText ?? null;
      if (!files.length && !submissionText?.trim()) {
        throw badRequest("Add an answer or attach a file before submitting.", "empty_submission");
      }

      const revision = existing?.submittedAt
        ? [{
            at: (existing.submittedAt ?? existing.updatedAt).toISOString(),
            text: existing.submissionText,
            files: existing.submittedFiles ?? [],
          }, ...(existing.revisionHistory ?? [])].slice(0, MAX_REVISIONS)
        : (existing?.revisionHistory ?? []);

      let saved: AssignmentSubmission;
      if (existing) {
        [saved] = await tx
          .update(assignmentSubmissionsTable)
          .set({
            submissionText,
            submittedFiles: files,
            submittedAt: now,
            revisionHistory: revision,
            isLate,
            status: "submitted",
            updatedAt: now,
          })
          .where(eq(assignmentSubmissionsTable.id, existing.id))
          .returning();
      } else {
        [saved] = await tx
          .insert(assignmentSubmissionsTable)
          .values({
            schoolId: ctx.schoolId,
            assignmentId,
            studentId: student.id,
            submissionText,
            submittedFiles: files,
            submittedAt: now,
            revisionHistory: [],
            isLate,
            status: "submitted",
          })
          .returning();
      }

      send(res, SubmitAssignmentResponse, {
        success: true,
        id: saved.id,
        submittedAt: saved.submittedAt ?? now,
        status: saved.status,
        isLate: saved.isLate,
      }, 201);
    });
  });

  // PUT /api/v1/assignments/:assignmentId/submit — save a draft attempt
  router.put("/:assignmentId/submit", async (req, res) => {
    const { assignmentId } = parseInput(UpdateAssignmentSubmissionParams, req.params);
    const input = parseInput(UpdateAssignmentSubmissionBody, req.body);

    await inSchool(database, req, res, ANY_MEMBER, async (tx, ctx) => {
      const student = await getStudent(tx, currentUserId(res), ctx.schoolId);
      if (!student) {
        throw badRequest("User is not a student in this school.", "not_a_student");
      }

      const [assignment] = await tx
        .select()
        .from(assignmentsTable)
        .where(
          and(eq(assignmentsTable.id, assignmentId), eq(assignmentsTable.schoolId, ctx.schoolId)),
        );
      if (!assignment || assignment.classId !== student.classId) {
        throw notFound("Assignment not found.");
      }

      const [submission] = await tx
        .select()
        .from(assignmentSubmissionsTable)
        .where(
          and(
            eq(assignmentSubmissionsTable.assignmentId, assignmentId),
            eq(assignmentSubmissionsTable.studentId, student.id),
          ),
        );
      // Graded work is immutable whatever the resubmission setting says about fresh attempts.
      if (submission && (submission.status === "graded" || submission.marksObtained !== null
        || submission.markedAt !== null || submission.gradedByUserId !== null)) {
        throw badRequest("Graded submissions cannot be changed.", "submission_graded");
      }
      if (!assignment.allowResubmission) {
        throw badRequest("This assignment does not accept saved drafts.", "resubmission_disabled");
      }
      if (new Date() > deadlineOf(assignment)) {
        throw badRequest("Assignment deadline has passed.", "deadline_exceeded");
      }
      if (!submission) throw notFound("Submission not found.");

      const files = input.files
        ? await confirmStoredFiles(requireStorage(deps), {
            schoolId: ctx.schoolId,
            classId: assignment.classId,
            location: "submissions",
          }, input.files)
        : submission.submittedFiles;
      files.forEach((file) => assertAllowedType(assignment.allowedFileTypes ?? [], file));

      await tx
        .update(assignmentSubmissionsTable)
        .set({
          submissionText: input.submissionText !== undefined ? input.submissionText : submission.submissionText,
          submittedFiles: files,
          status: "in_progress",
          updatedAt: new Date(),
        })
        .where(eq(assignmentSubmissionsTable.id, submission.id));

      send(res, UpdateAssignmentSubmissionResponse, { success: true, status: "in_progress" });
    });
  });

  router.get("/:assignmentId/submission", async (req, res) => {
    const { assignmentId } = parseInput(GetAssignmentSubmissionParams, req.params);

    await inSchool(database, req, res, ANY_MEMBER, async (tx, ctx) => {
      const student = await getStudent(tx, currentUserId(res), ctx.schoolId);
      if (!student) {
        throw badRequest("User is not a student in this school.", "not_a_student");
      }

      const [submission] = await tx
        .select()
        .from(assignmentSubmissionsTable)
        .where(
          and(
            eq(assignmentSubmissionsTable.assignmentId, assignmentId),
            eq(assignmentSubmissionsTable.studentId, student.id),
            eq(assignmentSubmissionsTable.schoolId, ctx.schoolId),
          ),
        );
      if (!submission) throw notFound("Submission not found.");

      send(res, GetAssignmentSubmissionResponse, submissionView(submission));
    });
  });

  router.put("/:assignmentId", async (req, res) => {
    const { assignmentId } = parseInput(UpdateAssignmentParams, req.params);
    const input = parseInput(UpdateAssignmentBody, req.body);

    await inSchool(database, req, res, MANAGE_ACCESS, async (tx, ctx) => {
      const { assignment } = await loadManaged(tx, ctx, assignmentId);

      const [submission] = await tx
        .select({ id: assignmentSubmissionsTable.id })
        .from(assignmentSubmissionsTable)
        .where(eq(assignmentSubmissionsTable.assignmentId, assignmentId));
      if (submission) {
        throw badRequest(
          "Cannot update assignment after submissions have been made.",
          "has_submissions",
        );
      }

      const files = input.files
        ? await confirmStoredFiles(requireStorage(deps), {
            schoolId: ctx.schoolId,
            classId: assignment.classId,
            location: "assignments",
          }, input.files)
        : assignment.attachments;
      const allowed = input.allowedFileTypes ?? assignment.allowedFileTypes ?? [];
      files.forEach((file) => assertAllowedType(allowed, file));

      const [updated] = await tx
        .update(assignmentsTable)
        .set({
          subject: input.subject ?? assignment.subject,
          title: input.title ?? assignment.title,
          description: input.description !== undefined ? input.description : assignment.description,
          marksAllocated: input.marksAllocated ?? assignment.marksAllocated,
          deadlineDate: input.deadlineDate ?? assignment.deadlineDate,
          deadlineTime: input.deadlineTime !== undefined ? input.deadlineTime : assignment.deadlineTime,
          instructions: input.instructions ?? assignment.instructions,
          attachedResourceIds: input.attachedResourceIds ?? assignment.attachedResourceIds,
          allowResubmission: input.allowResubmission ?? assignment.allowResubmission,
          assignmentKind: input.assignmentKind ?? assignment.assignmentKind,
          topic: input.topic !== undefined ? input.topic : assignment.topic,
          allowLate: input.allowLate ?? assignment.allowLate,
          allowedFileTypes: allowed,
          attachments: files,
          updatedAt: new Date(),
        })
        .where(eq(assignmentsTable.id, assignmentId))
        .returning();

      send(res, UpdateAssignmentResponse, {
        id: updated.id,
        subject: updated.subject,
        title: updated.title,
        updatedAt: updated.updatedAt,
      });
    });
  });

  // GET /api/v1/assignments/:assignmentId/submissions — whole-class marking roster
  router.get("/:assignmentId/submissions", async (req, res) => {
    const { assignmentId } = parseInput(ListAssignmentSubmissionsParams, req.params);
    const query = parseInput(ListAssignmentSubmissionsQueryParams, req.query);

    await inSchool(database, req, res, MANAGE_ACCESS, async (tx, ctx) => {
      const [assignment] = await tx
        .select()
        .from(assignmentsTable)
        .where(and(eq(assignmentsTable.id, assignmentId), eq(assignmentsTable.schoolId, ctx.schoolId)));
      if (!assignment) throw notFound("Assignment not found.");
      await assertCanManage(tx, ctx.schoolId, assignment.classId);

      const roster = await tx.execute<RosterRow>(sql`
        SELECT student_id, full_name, admission_number
        FROM app_private.assignment_roster(${ctx.schoolId}::uuid, ${assignmentId}::uuid)
      `);
      const submissions = await tx
        .select()
        .from(assignmentSubmissionsTable)
        .where(
          and(
            eq(assignmentSubmissionsTable.assignmentId, assignmentId),
            eq(assignmentSubmissionsTable.schoolId, ctx.schoolId),
          ),
        );
      const byStudent = new Map(submissions.map((s) => [s.studentId, s]));
      const now = new Date();
      const search = query.search?.trim().toLowerCase() ?? "";

      let rows = roster.rows.map((entry) => {
        const submission = byStudent.get(entry.student_id) ?? null;
        return {
          id: submission?.id ?? null,
          studentId: entry.student_id,
          studentName: entry.full_name,
          admissionNumber: entry.admission_number,
          submittedAt: submission?.submittedAt ?? null,
          submittedText: submission?.submissionText ?? null,
          submittedFiles: submission ? filesOf(submission.submittedFiles, submission.updatedAt) : [],
          marksObtained: submission?.marksObtained != null ? parseFloat(submission.marksObtained) : null,
          feedback: submission?.feedback ?? null,
          markedAt: submission?.markedAt ?? null,
          status: calculateSubmissionStatus(assignment, submission, now),
          isLate: submission?.isLate ?? false,
        };
      });

      const submissionCount = rows.filter((row) => row.submittedAt).length;
      const gradedCount = rows.filter((row) => row.marksObtained !== null).length;

      if (search) {
        rows = rows.filter((row) =>
          `${row.studentName} ${row.admissionNumber}`.toLowerCase().includes(search));
      }
      if (query.filter === "submitted") rows = rows.filter((row) => row.submittedAt !== null);
      if (query.filter === "graded") rows = rows.filter((row) => row.marksObtained !== null);
      if (query.filter === "pending") rows = rows.filter((row) => row.submittedAt !== null && row.marksObtained === null);
      if (query.filter === "late") rows = rows.filter((row) => row.isLate);

      rows.sort((a, b) => {
        if (query.sort === "submitted") return (b.submittedAt?.getTime() ?? 0) - (a.submittedAt?.getTime() ?? 0);
        if (query.sort === "marks") return (b.marksObtained ?? -1) - (a.marksObtained ?? -1);
        return `${a.studentName}`.localeCompare(`${b.studentName}`);
      });

      send(res, ListAssignmentSubmissionsResponse, {
        data: rows.slice(query.offset, query.offset + query.limit),
        total: rows.length,
        submissionCount,
        gradedCount,
        notSubmittedCount: rows.length - submissionCount,
      });
    });
  });

  // GET /api/v1/assignments/:assignmentId/submissions/:submissionId/files/:fileId/download
  router.get("/:assignmentId/submissions/:submissionId/files/:fileId/download", async (req, res) => {
    const { assignmentId, submissionId, fileId } = parseInput(DownloadSubmissionFileParams, req.params);

    await inSchool(database, req, res, MANAGE_ACCESS, async (tx, ctx) => {
      const [assignment] = await tx
        .select({ id: assignmentsTable.id, classId: assignmentsTable.classId })
        .from(assignmentsTable)
        .where(and(eq(assignmentsTable.id, assignmentId), eq(assignmentsTable.schoolId, ctx.schoolId)));
      if (!assignment) throw notFound("Assignment not found.");
      await assertCanManage(tx, ctx.schoolId, assignment.classId);

      const [submission] = await tx
        .select()
        .from(assignmentSubmissionsTable)
        .where(
          and(
            eq(assignmentSubmissionsTable.id, submissionId),
            eq(assignmentSubmissionsTable.assignmentId, assignmentId),
            eq(assignmentSubmissionsTable.schoolId, ctx.schoolId),
          ),
        );
      if (!submission) throw notFound("Submission not found.");

      const file = findAttachment(submission.submittedFiles ?? [], fileId);
      const grant = await requireStorage(deps).downloadGrant(file.path, file.name);
      send(res, DownloadSubmissionFileResponse, grant);
    });
  });

  // POST /api/v1/assignments/:assignmentId/submissions/:submissionId/mark
  router.post("/:assignmentId/submissions/:submissionId/mark", async (req, res) => {
    const { assignmentId, submissionId } = parseInput(MarkAssignmentSubmissionParams, req.params);
    const input = parseInput(MarkAssignmentSubmissionBody, req.body);

    await inSchool(database, req, res, MANAGE_ACCESS, async (tx, ctx) => {
      const [assignment] = await tx
        .select({ id: assignmentsTable.id, marksAllocated: assignmentsTable.marksAllocated, title: assignmentsTable.title })
        .from(assignmentsTable)
        .where(
          and(eq(assignmentsTable.id, assignmentId), eq(assignmentsTable.schoolId, ctx.schoolId)),
        );
      if (!assignment) throw notFound("Assignment not found.");
      if (input.marksObtained > assignment.marksAllocated) {
        throw badRequest("Marks cannot exceed the assignment maximum.", "marks_exceeded");
      }

      const [submission] = await tx
        .select()
        .from(assignmentSubmissionsTable)
        .where(
          and(
            eq(assignmentSubmissionsTable.id, submissionId),
            eq(assignmentSubmissionsTable.assignmentId, assignmentId),
            eq(assignmentSubmissionsTable.schoolId, ctx.schoolId),
          ),
        );
      if (!submission) throw notFound("Submission not found.");

      const now = new Date();
      await tx
        .update(assignmentSubmissionsTable)
        .set({
          marksObtained: input.marksObtained.toString(),
          feedback: input.feedback ?? submission.feedback,
          gradedByUserId: ctx.userId,
          markedAt: now,
          status: "graded",
          updatedAt: now,
        })
        .where(eq(assignmentSubmissionsTable.id, submissionId));

      await tx.execute(sql`
        SELECT app_private.notify_student(${ctx.schoolId}::uuid, ${submission.studentId}::uuid,
          'submission.graded', ${`Feedback on ${assignment.title}`},
          ${`You scored ${input.marksObtained} of ${assignment.marksAllocated}. Open the assignment to read the feedback.`}::text,
          ${assignmentId}::uuid)
      `);

      send(res, MarkAssignmentSubmissionResponse, {
        success: true,
        marksObtained: input.marksObtained,
        markedAt: now,
        status: "graded",
      });
    });
  });

  async function loadManaged(tx: Tx, ctx: { schoolId: string }, assignmentId: string) {
    const [assignment] = await tx
      .select()
      .from(assignmentsTable)
      .where(and(eq(assignmentsTable.id, assignmentId), eq(assignmentsTable.schoolId, ctx.schoolId)));
    if (!assignment) throw notFound("Assignment not found.");
    await assertCanManage(tx, ctx.schoolId, assignment.classId);
    return { assignment };
  }

  async function notifyClass(tx: Tx, schoolId: string, assignment: Assignment, entityId: string) {
    await tx.execute(sql`
      SELECT app_private.notify_class(${schoolId}::uuid, ${assignment.classId}::uuid,
        'assignment.published', ${`New ${assignment.assignmentKind}: ${assignment.subject}`},
        ${`"${assignment.title}" is due ${assignment.deadlineDate}.`}::text,
        ${entityId}::uuid)
    `);
  }

  return router;
}

type RosterRow = { student_id: string; full_name: string | null; admission_number: string | null };

export default assignmentsRouter;
