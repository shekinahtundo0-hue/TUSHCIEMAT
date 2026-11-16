import { Router } from "express";
import { and, eq, desc, gte, lte, inArray, sql } from "drizzle-orm";
import {
  assignmentsTable,
  assignmentSubmissionsTable,
  studentsTable,
  classesTable,
  userProfilesTable,
} from "@workspace/db/schema";
import { inSchool, send, currentUserId } from "../../lib/context";
import type { AppDeps } from "../../lib/deps";
import { parseInput, badRequest, forbidden, notFound, conflict } from "../../lib/errors";
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

function calculateSubmissionStatus(assignment: any, submission: any | null, now: Date): string {
  if (!submission) {
    const deadline = new Date(`${assignment.deadlineDate}T${assignment.deadlineTime || "23:59:59"}`);
    return now > deadline ? "overdue" : "not_started";
  }
  if (!submission.submittedAt) {
    const deadline = new Date(`${assignment.deadlineDate}T${assignment.deadlineTime || "23:59:59"}`);
    return now > deadline ? "overdue" : "in_progress";
  }
  return submission.marksObtained !== null ? "graded" : "submitted";
}

// ============================================================================
// Route Handlers
// ============================================================================

export function assignmentsRouter(deps: AppDeps): Router {
  const router = Router();
  const { database, logger } = deps;

  /**
   * GET /api/v1/assignments
   * Returns assignments for current student's class
   */
  router.get("/", async (req, res) => {
    const query = parseInput(
      {
        status: { type: "string", required: false },
        subject: { type: "string", required: false },
        limit: { type: "number", required: false, default: 20 },
        offset: { type: "number", required: false, default: 0 },
      },
      req.query,
    );

    await inSchool(database, req, res, ANY_MEMBER, async (tx, ctx) => {
      const userId = currentUserId(res);
      const studentId = await getStudentId(tx, database, userId, ctx.schoolId);

      if (!studentId) {
        throw badRequest("User is not a student in this school.", "not_a_student");
      }

      // Get student's class
      const [student] = await tx
        .select({ classId: studentsTable.classId })
        .from(studentsTable)
        .where(eq(studentsTable.id, studentId));

      if (!student?.classId) {
        throw badRequest("Student is not enrolled in a class.", "no_class");
      }

      // Get assignments for this class
      let assignmentQuery = tx
        .select()
        .from(assignmentsTable)
        .where(
          and(
            eq(assignmentsTable.schoolId, ctx.schoolId),
            eq(assignmentsTable.classId, student.classId),
            query.subject ? eq(assignmentsTable.subject, query.subject) : undefined,
          ),
        );

      const assignments = await assignmentQuery
        .orderBy(desc(assignmentsTable.createdAt))
        .limit(query.limit)
        .offset(query.offset);

      const now = new Date();
      const assignmentIds = assignments.map((a) => a.id);

      // Get submissions for this student
      let submissions = [];
      if (assignmentIds.length > 0) {
        submissions = await tx
          .select()
          .from(assignmentSubmissionsTable)
          .where(
            and(
              inArray(assignmentSubmissionsTable.assignmentId, assignmentIds),
              eq(assignmentSubmissionsTable.studentId, studentId),
            ),
          );
      }

      const submissionMap = Object.fromEntries(
        submissions.map((s) => [s.assignmentId, s]),
      );

      // Filter by status if provided
      let filtered = assignments.map((a) => ({
        id: a.id,
        classId: a.classId,
        subject: a.subject,
        title: a.title,
        description: a.description,
        deadlineDate: a.deadlineDate,
        deadlineTime: a.deadlineTime,
        marksAllocated: a.marksAllocated,
        status: calculateSubmissionStatus(a, submissionMap[a.id], now),
        createdAt: a.createdAt,
      }));

      if (query.status) {
        filtered = filtered.filter((a) => a.status === query.status);
      }

      send(res, { data: filtered, total: filtered.length, hasMore: false });
    });
  });

  /**
   * GET /api/v1/assignments/:assignmentId
   * Returns full assignment + current student's submission + marks/feedback
   */
  router.get("/:assignmentId", async (req, res) => {
    const { assignmentId } = req.params;

    await inSchool(database, req, res, ANY_MEMBER, async (tx, ctx) => {
      const userId = currentUserId(res);
      const studentId = await getStudentId(tx, database, userId, ctx.schoolId);

      if (!studentId) {
        throw badRequest("User is not a student in this school.", "not_a_student");
      }

      const [assignment] = await tx
        .select()
        .from(assignmentsTable)
        .where(
          and(
            eq(assignmentsTable.id, assignmentId),
            eq(assignmentsTable.schoolId, ctx.schoolId),
          ),
        );

      if (!assignment) throw notFound("Assignment not found.");

      // Get student's submission
      const [submission] = await tx
        .select()
        .from(assignmentSubmissionsTable)
        .where(
          and(
            eq(assignmentSubmissionsTable.assignmentId, assignmentId),
            eq(assignmentSubmissionsTable.studentId, studentId),
          ),
        );

      const now = new Date();
      const result = {
        id: assignment.id,
        subject: assignment.subject,
        title: assignment.title,
        description: assignment.description,
        instructions: assignment.instructions,
        attachedResourceIds: assignment.attachedResourceIds,
        marksAllocated: assignment.marksAllocated,
        deadlineDate: assignment.deadlineDate,
        deadlineTime: assignment.deadlineTime,
        allowResubmission: assignment.allowResubmission,
        createdAt: assignment.createdAt,
        submission: submission
          ? {
              id: submission.id,
              submissionText: submission.submissionText,
              submittedFiles: submission.submittedFiles,
              submittedAt: submission.submittedAt,
              marksObtained: submission.marksObtained
                ? parseFloat(submission.marksObtained)
                : null,
              feedback: submission.feedback,
              markedAt: submission.markedAt,
              status: submission.status,
            }
          : null,
        status: calculateSubmissionStatus(assignment, submission, now),
      };

      send(res, result);
    });
  });

  /**
   * POST /api/v1/assignments/:assignmentId/submit
   * Creates/updates assignment submission with file uploads
   */
  router.post("/:assignmentId/submit", async (req, res) => {
    const { assignmentId } = req.params;
    const { submissionText, fileIds } = parseInput(
      {
        submissionText: { type: "string", required: false },
        fileIds: { type: "array", required: false },
      },
      req.body,
    );

    await inSchool(database, req, res, ANY_MEMBER, async (tx, ctx) => {
      const userId = currentUserId(res);
      const studentId = await getStudentId(tx, database, userId, ctx.schoolId);

      if (!studentId) {
        throw badRequest("User is not a student in this school.", "not_a_student");
      }

      const [assignment] = await tx
        .select()
        .from(assignmentsTable)
        .where(
          and(
            eq(assignmentsTable.id, assignmentId),
            eq(assignmentsTable.schoolId, ctx.schoolId),
          ),
        );

      if (!assignment) throw notFound("Assignment not found.");

      // Check deadline
      const now = new Date();
      const deadlineStr = assignment.deadlineTime
        ? `${assignment.deadlineDate}T${assignment.deadlineTime}`
        : `${assignment.deadlineDate}T23:59:59`;
      const deadline = new Date(deadlineStr);

      if (now > deadline) {
        throw badRequest("Assignment deadline has passed.", "deadline_exceeded");
      }

      // Check existing submission
      const [existing] = await tx
        .select()
        .from(assignmentSubmissionsTable)
        .where(
          and(
            eq(assignmentSubmissionsTable.assignmentId, assignmentId),
            eq(assignmentSubmissionsTable.studentId, studentId),
          ),
        );

      if (existing && existing.submittedAt && !assignment.allowResubmission) {
        throw conflict(
          "Assignment already submitted. Resubmission is not allowed.",
        );
      }

      const submittedFiles = fileIds
        ? fileIds.map((id: string) => ({
            id,
            name: `file_${id}`,
            size: 0,
            type: "file",
          }))
        : [];

      const now_ts = new Date();

      if (existing) {
        // Update existing submission
        await tx
          .update(assignmentSubmissionsTable)
          .set({
            submissionText: submissionText || existing.submissionText,
            submittedFiles,
            submittedAt: existing.submittedAt || now_ts,
            status: "submitted",
            updatedAt: now_ts,
          })
          .where(eq(assignmentSubmissionsTable.id, existing.id));
      } else {
        // Create new submission
        await tx.insert(assignmentSubmissionsTable).values({
          schoolId: ctx.schoolId,
          assignmentId,
          studentId,
          submissionText,
          submittedFiles,
          submittedAt: now_ts,
          status: "submitted",
        });
      }

      send(
        res,
        {
          success: true,
          submittedAt: now_ts,
          status: "submitted",
        },
        201,
      );
    });
  });

  /**
   * PUT /api/v1/assignments/:assignmentId/submit
   * Updates submission before deadline
   */
  router.put("/:assignmentId/submit", async (req, res) => {
    const { assignmentId } = req.params;
    const { submissionText, fileIds } = parseInput(
      {
        submissionText: { type: "string", required: false },
        fileIds: { type: "array", required: false },
      },
      req.body,
    );

    await inSchool(database, req, res, ANY_MEMBER, async (tx, ctx) => {
      const userId = currentUserId(res);
      const studentId = await getStudentId(tx, database, userId, ctx.schoolId);

      if (!studentId) {
        throw badRequest("User is not a student in this school.", "not_a_student");
      }

      const [assignment] = await tx
        .select()
        .from(assignmentsTable)
        .where(
          and(
            eq(assignmentsTable.id, assignmentId),
            eq(assignmentsTable.schoolId, ctx.schoolId),
          ),
        );

      if (!assignment) throw notFound("Assignment not found.");

      // Check deadline
      const now = new Date();
      const deadlineStr = assignment.deadlineTime
        ? `${assignment.deadlineDate}T${assignment.deadlineTime}`
        : `${assignment.deadlineDate}T23:59:59`;
      const deadline = new Date(deadlineStr);

      if (now > deadline) {
        throw badRequest("Assignment deadline has passed.", "deadline_exceeded");
      }

      const [submission] = await tx
        .select()
        .from(assignmentSubmissionsTable)
        .where(
          and(
            eq(assignmentSubmissionsTable.assignmentId, assignmentId),
            eq(assignmentSubmissionsTable.studentId, studentId),
          ),
        );

      if (!submission) {
        throw notFound("Submission not found.");
      }

      const submittedFiles = fileIds
        ? fileIds.map((id: string) => ({
            id,
            name: `file_${id}`,
            size: 0,
            type: "file",
          }))
        : submission.submittedFiles;

      await tx
        .update(assignmentSubmissionsTable)
        .set({
          submissionText: submissionText !== undefined ? submissionText : submission.submissionText,
          submittedFiles,
          status: "in_progress",
          updatedAt: new Date(),
        })
        .where(eq(assignmentSubmissionsTable.id, submission.id));

      send(res, { success: true, status: "in_progress" });
    });
  });

  /**
   * GET /api/v1/assignments/:assignmentId/submission
   * Returns current student's submission + feedback + marks
   */
  router.get("/:assignmentId/submission", async (req, res) => {
    const { assignmentId } = req.params;

    await inSchool(database, req, res, ANY_MEMBER, async (tx, ctx) => {
      const userId = currentUserId(res);
      const studentId = await getStudentId(tx, database, userId, ctx.schoolId);

      if (!studentId) {
        throw badRequest("User is not a student in this school.", "not_a_student");
      }

      const [submission] = await tx
        .select()
        .from(assignmentSubmissionsTable)
        .where(
          and(
            eq(assignmentSubmissionsTable.assignmentId, assignmentId),
            eq(assignmentSubmissionsTable.studentId, studentId),
            eq(assignmentSubmissionsTable.schoolId, ctx.schoolId),
          ),
        );

      if (!submission) {
        throw notFound("Submission not found.");
      }

      const result = {
        id: submission.id,
        submissionText: submission.submissionText,
        submittedFiles: submission.submittedFiles,
        submittedAt: submission.submittedAt,
        marksObtained: submission.marksObtained
          ? parseFloat(submission.marksObtained)
          : null,
        feedback: submission.feedback,
        markedAt: submission.markedAt,
        status: submission.status,
      };

      send(res, result);
    });
  });

  /**
   * POST /api/v1/assignments
   * Creates assignment (teacher/admin)
   */
  router.post("/", async (req, res) => {
    const {
      classId,
      subject,
      title,
      description,
      instructions,
      attachedResourceIds,
      marksAllocated,
      deadlineDate,
      deadlineTime,
      allowResubmission,
    } = parseInput(
      {
        classId: { type: "string", required: true },
        subject: { type: "string", required: true },
        title: { type: "string", required: true },
        description: { type: "string", required: false },
        instructions: { type: "array", required: false },
        attachedResourceIds: { type: "array", required: false },
        marksAllocated: { type: "number", required: true },
        deadlineDate: { type: "string", required: true },
        deadlineTime: { type: "string", required: false },
        allowResubmission: { type: "boolean", required: false },
      },
      req.body,
    );

    if (marksAllocated <= 0) {
      throw badRequest("Marks allocated must be greater than 0.", "validation_failed");
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

        const [assignment] = await tx
          .insert(assignmentsTable)
          .values({
            schoolId: ctx.schoolId,
            classId,
            subject: subject.trim(),
            title: title.trim(),
            description: description?.trim(),
            instructions: instructions || [],
            attachedResourceIds: attachedResourceIds || [],
            marksAllocated,
            deadlineDate,
            deadlineTime: deadlineTime || null,
            allowResubmission: allowResubmission || false,
            createdByUserId: userId,
          })
          .returning();

        send(
          res,
          {
            id: assignment.id,
            classId: assignment.classId,
            subject: assignment.subject,
            title: assignment.title,
            marksAllocated: assignment.marksAllocated,
            deadlineDate: assignment.deadlineDate,
            createdAt: assignment.createdAt,
          },
          201,
        );
      },
    );
  });

  /**
   * PUT /api/v1/assignments/:assignmentId
   * Updates assignment (only if no submissions)
   */
  router.put("/:assignmentId", async (req, res) => {
    const { assignmentId } = req.params;
    const { subject, title, description, marksAllocated, deadlineDate, deadlineTime } = parseInput(
      {
        subject: { type: "string", required: false },
        title: { type: "string", required: false },
        description: { type: "string", required: false },
        marksAllocated: { type: "number", required: false },
        deadlineDate: { type: "string", required: false },
        deadlineTime: { type: "string", required: false },
      },
      req.body,
    );

    await inSchool(
      database,
      req,
      res,
      { roles: STAFF, capability: "classroom.manage" },
      async (tx, ctx) => {
        const [assignment] = await tx
          .select()
          .from(assignmentsTable)
          .where(
            and(
              eq(assignmentsTable.id, assignmentId),
              eq(assignmentsTable.schoolId, ctx.schoolId),
            ),
          );

        if (!assignment) throw notFound("Assignment not found.");

        // Check if any submissions exist
        const [submission] = await tx
          .select()
          .from(assignmentSubmissionsTable)
          .where(eq(assignmentSubmissionsTable.assignmentId, assignmentId));

        if (submission) {
          throw badRequest(
            "Cannot update assignment after submissions have been made.",
            "has_submissions",
          );
        }

        const updateData: any = { updatedAt: new Date() };
        if (subject) updateData.subject = subject;
        if (title) updateData.title = title;
        if (description !== undefined) updateData.description = description;
        if (marksAllocated) updateData.marksAllocated = marksAllocated;
        if (deadlineDate) updateData.deadlineDate = deadlineDate;
        if (deadlineTime !== undefined) updateData.deadlineTime = deadlineTime;

        const [updated] = await tx
          .update(assignmentsTable)
          .set(updateData)
          .where(eq(assignmentsTable.id, assignmentId))
          .returning();

        send(res, {
          id: updated.id,
          subject: updated.subject,
          title: updated.title,
          updatedAt: updated.updatedAt,
        });
      },
    );
  });

  /**
   * GET /api/v1/assignments/:assignmentId/submissions
   * Returns all submissions for assignment (teacher/admin, paginated)
   */
  router.get("/:assignmentId/submissions", async (req, res) => {
    const { assignmentId } = req.params;
    const query = parseInput(
      {
        limit: { type: "number", required: false, default: 20 },
        offset: { type: "number", required: false, default: 0 },
        status: { type: "string", required: false },
      },
      req.query,
    );

    await inSchool(
      database,
      req,
      res,
      { roles: STAFF, capability: "classroom.manage" },
      async (tx, ctx) => {
        // Verify assignment exists and belongs to school
        const [assignment] = await tx
          .select()
          .from(assignmentsTable)
          .where(
            and(
              eq(assignmentsTable.id, assignmentId),
              eq(assignmentsTable.schoolId, ctx.schoolId),
            ),
          );

        if (!assignment) throw notFound("Assignment not found.");

        // Get submissions
        let submissionQuery = tx
          .select()
          .from(assignmentSubmissionsTable)
          .where(
            and(
              eq(assignmentSubmissionsTable.assignmentId, assignmentId),
              eq(assignmentSubmissionsTable.schoolId, ctx.schoolId),
              query.status
                ? eq(assignmentSubmissionsTable.status, query.status)
                : undefined,
            ),
          );

        const submissions = await submissionQuery
          .limit(query.limit)
          .offset(query.offset);

        const result = submissions.map((s) => ({
          id: s.id,
          studentId: s.studentId,
          submittedAt: s.submittedAt,
          marksObtained: s.marksObtained ? parseFloat(s.marksObtained) : null,
          status: s.status,
          feedback: s.feedback,
        }));

        send(res, { data: result, total: result.length });
      },
    );
  });

  /**
   * POST /api/v1/assignments/:assignmentId/submissions/:submissionId/mark
   * Grades a submission (teacher/admin)
   */
  router.post("/:assignmentId/submissions/:submissionId/mark", async (req, res) => {
    const { assignmentId, submissionId } = req.params;
    const { marksObtained, feedback } = parseInput(
      {
        marksObtained: { type: "number", required: true },
        feedback: { type: "string", required: false },
      },
      req.body,
    );

    if (marksObtained < 0) {
      throw badRequest("Marks obtained cannot be negative.", "validation_failed");
    }

    await inSchool(
      database,
      req,
      res,
      { roles: STAFF, capability: "classroom.manage" },
      async (tx, ctx) => {
        const userId = currentUserId(res);

        // Verify assignment exists
        const [assignment] = await tx
          .select()
          .from(assignmentsTable)
          .where(
            and(
              eq(assignmentsTable.id, assignmentId),
              eq(assignmentsTable.schoolId, ctx.schoolId),
            ),
          );

        if (!assignment) throw notFound("Assignment not found.");

        // Verify submission exists
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
            marksObtained: marksObtained.toString(),
            feedback: feedback || submission.feedback,
            gradedByUserId: userId,
            markedAt: now,
            status: "graded",
            updatedAt: now,
          })
          .where(eq(assignmentSubmissionsTable.id, submissionId));

        send(
          res,
          {
            success: true,
            marksObtained,
            markedAt: now,
            status: "graded",
          },
          200,
        );
      },
    );
  });

  return router;
}

export default assignmentsRouter;
