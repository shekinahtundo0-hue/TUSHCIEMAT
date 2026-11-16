import { Router } from "express";
import { and, eq, desc, gte, lte, inArray, sql } from "drizzle-orm";
import {
  assessmentsTable,
  classesTable,
  studentAssessmentMarksTable,
  studentsTable,
  termsTable,
  studentTermAggregatesTable,
  resultPublicationsTable,
  schoolMembershipsTable,
  userProfilesTable,
} from "@workspace/db/schema";
import { inSchool, send, currentUserId } from "../../lib/context";
import type { AppDeps } from "../../lib/deps";
import { parseInput, badRequest, forbidden, notFound } from "../../lib/errors";
import { ANY_MEMBER, STAFF, GUARDIAN } from "../../lib/roles";

// ============================================================================
// Response Types (would normally come from @workspace/api-zod)
// ============================================================================

interface AssessmentResponse {
  id: string;
  subject: string;
  assessmentTypeName: string;
  maxMarks: number;
  termName: string;
}

interface AssessmentMarkResponse {
  assessmentId: string;
  subject: string;
  maxMarks: number;
  marksObtained: number | null;
  feedback?: string;
  markedAt?: string;
}

interface TermResultsResponse {
  termId: string;
  termName: string;
  termData: {
    startsOn: string;
    endsOn: string;
  };
  subjectResults: Array<{
    subject: string;
    totalMarks: number | null;
    averagePercentage: number | null;
    grade?: string;
    position?: number;
  }>;
  overallAverage: number | null;
  classPosition: number | null;
}

interface AssessmentDetailsResponse {
  id: string;
  subject: string;
  maxMarks: number;
  assessmentType: string;
  term: {
    id: string;
    name: string;
    startsOn: string;
    endsOn: string;
  };
  class: {
    id: string;
    name: string;
  };
  studentMark?: {
    marksObtained: number | null;
    feedback?: string;
    submissionStatus: string;
    markedAt?: string;
  };
  isPublished: boolean;
}

// ============================================================================
// Helper Functions
// ============================================================================

async function getStudentId(tx: any, database: any, userId: string, schoolId: string): Promise<string | null> {
  const [student] = await tx
    .select({ id: studentsTable.id })
    .from(studentsTable)
    .where(
      and(
        eq(studentsTable.schoolId, schoolId),
        eq(studentsTable.authUserId, userId),
      ),
    );
  return student?.id || null;
}

async function getParentVerifiedStudentId(
  tx: any,
  userId: string,
  schoolId: string,
  studentId: string,
): Promise<boolean> {
  const [link] = await tx.execute(sql`
    SELECT 1 FROM student_guardians
    WHERE guardian_id = ${studentId}
      AND user_id = ${userId}
      AND school_id = ${schoolId}
      AND status = 'verified'
    LIMIT 1
  `);
  return !!link;
}

async function isAssessmentPublished(tx: any, assessmentId: string, termId: string): Promise<boolean> {
  const [pub] = await tx
    .select()
    .from(resultPublicationsTable)
    .where(
      and(
        eq(resultPublicationsTable.termId, termId),
        eq(resultPublicationsTable.status, "published"),
      ),
    );
  return !!pub;
}

// ============================================================================
// Route Handlers
// ============================================================================

export function resultsRouter(deps: AppDeps): Router {
  const router = Router();
  const { database, logger } = deps;

  /**
   * GET /api/v1/results/my-assessments
   * Returns assessments for current student's class in current term
   */
  router.get("/my-assessments", async (req, res) => {
    const query = parseInput(
      {
        termId: { type: "string", required: false },
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
      const [enrollment] = await tx
        .select({ classId: studentsTable.classId })
        .from(studentsTable)
        .where(eq(studentsTable.id, studentId));

      if (!enrollment?.classId) {
        throw badRequest("Student is not enrolled in a class.", "no_class");
      }

      // Build query for assessments
      let assessmentQuery = tx
        .select({
          id: assessmentsTable.id,
          subject: assessmentsTable.subject,
          maxMarks: assessmentsTable.maxMarks,
          termId: assessmentsTable.termId,
        })
        .from(assessmentsTable)
        .where(
          and(
            eq(assessmentsTable.schoolId, ctx.schoolId),
            eq(assessmentsTable.classId, enrollment.classId),
            query.termId ? eq(assessmentsTable.termId, query.termId) : undefined,
            query.subject ? eq(assessmentsTable.subject, query.subject) : undefined,
          ),
        );

      const assessments = await assessmentQuery.limit(query.limit).offset(query.offset);

      // Get term info for each assessment
      const termIds = [...new Set(assessments.map((a) => a.termId))];
      const terms = await tx
        .select({ id: termsTable.id, name: termsTable.name })
        .from(termsTable)
        .where(inArray(termsTable.id, termIds));

      const termMap = Object.fromEntries(terms.map((t) => [t.id, t]));

      const result = assessments.map((a) => ({
        id: a.id,
        subject: a.subject,
        maxMarks: a.maxMarks,
        termName: termMap[a.termId]?.name || "Unknown",
      }));

      send(res, { data: result, total: assessments.length, hasMore: false });
    });
  });

  /**
   * GET /api/v1/results/published
   * Returns paginated published student assessment marks
   */
  router.get("/published", async (req, res) => {
    const query = parseInput(
      {
        limit: { type: "number", required: false, default: 20 },
        offset: { type: "number", required: false, default: 0 },
        sortBy: { type: "string", required: false, default: "recent" },
      },
      req.query,
    );

    await inSchool(database, req, res, ANY_MEMBER, async (tx, ctx) => {
      const userId = currentUserId(res);
      const studentId = await getStudentId(tx, database, userId, ctx.schoolId);

      if (!studentId) {
        throw badRequest("User is not a student in this school.", "not_a_student");
      }

      // Get published marks for this student
      let query_order = query.sortBy === "subject" ? "asc" : "desc";
      const marks = await tx.execute(sql`
        SELECT
          sam.id,
          sam.assessment_id,
          a.subject,
          a.max_marks,
          sam.marks_obtained,
          sam.feedback,
          sam.marked_at,
          rp.is_published
        FROM student_assessment_marks sam
        JOIN assessments a ON sam.assessment_id = a.id
        LEFT JOIN result_publications rp ON a.term_id = rp.term_id
          AND rp.school_id = ${ctx.schoolId}
          AND rp.is_published = true
        WHERE sam.student_id = ${studentId}
          AND sam.school_id = ${ctx.schoolId}
          AND rp.is_published = true
        ORDER BY ${query_order === "asc"
          ? sql`a.subject ASC`
          : sql`sam.marked_at DESC NULLS LAST`}
        LIMIT ${query.limit} OFFSET ${query.offset}
      `);

      const result = marks.rows.map((m: any) => ({
        id: m.id,
        assessmentId: m.assessment_id,
        subject: m.subject,
        maxMarks: m.max_marks,
        marksObtained: m.marks_obtained ? parseFloat(m.marks_obtained) : null,
        feedback: m.feedback,
        markedAt: m.marked_at,
      }));

      send(res, { data: result, total: result.length, hasMore: false });
    });
  });

  /**
   * GET /api/v1/results/by-subject/:subject
   * Returns all marks for a subject with assessment history and trend
   */
  router.get("/by-subject/:subject", async (req, res) => {
    const { subject } = req.params;

    await inSchool(database, req, res, ANY_MEMBER, async (tx, ctx) => {
      const userId = currentUserId(res);
      const studentId = await getStudentId(tx, database, userId, ctx.schoolId);

      if (!studentId) {
        throw badRequest("User is not a student in this school.", "not_a_student");
      }

      const marks = await tx
        .select({
          id: studentAssessmentMarksTable.id,
          assessmentId: studentAssessmentMarksTable.assessmentId,
          marksObtained: studentAssessmentMarksTable.marksObtained,
          feedback: studentAssessmentMarksTable.feedback,
          markedAt: studentAssessmentMarksTable.markedAt,
        })
        .from(studentAssessmentMarksTable)
        .innerJoin(
          assessmentsTable,
          eq(studentAssessmentMarksTable.assessmentId, assessmentsTable.id),
        )
        .where(
          and(
            eq(studentAssessmentMarksTable.studentId, studentId),
            eq(assessmentsTable.subject, subject),
            eq(studentAssessmentMarksTable.schoolId, ctx.schoolId),
          ),
        )
        .orderBy(desc(studentAssessmentMarksTable.markedAt));

      const result = marks.map((m) => ({
        id: m.id,
        assessmentId: m.assessmentId,
        marksObtained: m.marksObtained ? parseFloat(m.marksObtained) : null,
        feedback: m.feedback,
        markedAt: m.markedAt,
      }));

      send(res, { data: result, subject, averageTrend: null });
    });
  });

  /**
   * GET /api/v1/results/term/:termId
   * Returns term summary: subject-level aggregates, average, position
   */
  router.get("/term/:termId", async (req, res) => {
    const { termId } = req.params;

    await inSchool(database, req, res, ANY_MEMBER, async (tx, ctx) => {
      const userId = currentUserId(res);
      const studentId = await getStudentId(tx, database, userId, ctx.schoolId);

      if (!studentId) {
        throw badRequest("User is not a student in this school.", "not_a_student");
      }

      // Get term info
      const [term] = await tx
        .select()
        .from(termsTable)
        .where(and(eq(termsTable.id, termId), eq(termsTable.schoolId, ctx.schoolId)));

      if (!term) throw notFound("Term not found.");

      // Get student's term aggregates for this term
      const subjectResults = await tx
        .select()
        .from(studentTermAggregatesTable)
        .where(
          and(
            eq(studentTermAggregatesTable.studentId, studentId),
            eq(studentTermAggregatesTable.termId, termId),
            eq(studentTermAggregatesTable.schoolId, ctx.schoolId),
          ),
        );

      const result = {
        termId: term.id,
        termName: term.name,
        termData: {
          startsOn: term.startsOn,
          endsOn: term.endsOn,
        },
        subjectResults: subjectResults.map((s) => ({
          subject: s.subject,
          totalMarks: s.totalMarks ? parseFloat(s.totalMarks) : null,
          averagePercentage: s.averagePercentage ? parseFloat(s.averagePercentage) : null,
          grade: s.grade,
          position: s.positionInClass,
        })),
        overallAverage:
          subjectResults.length > 0
            ? parseFloat(
                (
                  subjectResults.reduce((sum, s) => {
                    const pct = s.averagePercentage ? parseFloat(s.averagePercentage) : 0;
                    return sum + pct;
                  }, 0) / subjectResults.length
                ).toFixed(2),
              )
            : null,
        classPosition: subjectResults[0]?.positionInClass || null,
      };

      send(res, result);
    });
  });

  /**
   * GET /api/v1/results/assessment/:assessmentId
   * Returns assessment details + current student's mark + feedback
   */
  router.get("/assessment/:assessmentId", async (req, res) => {
    const { assessmentId } = req.params;

    await inSchool(database, req, res, ANY_MEMBER, async (tx, ctx) => {
      const userId = currentUserId(res);
      const studentId = await getStudentId(tx, database, userId, ctx.schoolId);

      if (!studentId) {
        throw badRequest("User is not a student in this school.", "not_a_student");
      }

      // Get assessment details
      const [assessment] = await tx
        .select()
        .from(assessmentsTable)
        .where(
          and(
            eq(assessmentsTable.id, assessmentId),
            eq(assessmentsTable.schoolId, ctx.schoolId),
          ),
        );

      if (!assessment) throw notFound("Assessment not found.");

      // Check if published
      const isPublished = await isAssessmentPublished(tx, assessmentId, assessment.termId);

      // Get term and class info
      const [term] = await tx
        .select()
        .from(termsTable)
        .where(eq(termsTable.id, assessment.termId));

      const [cls] = await tx
        .select()
        .from(classesTable)
        .where(eq(classesTable.id, assessment.classId));

      // Get student's mark (only if published or own submission)
      let studentMark = null;
      if (isPublished) {
        const [mark] = await tx
          .select()
          .from(studentAssessmentMarksTable)
          .where(
            and(
              eq(studentAssessmentMarksTable.assessmentId, assessmentId),
              eq(studentAssessmentMarksTable.studentId, studentId),
              eq(studentAssessmentMarksTable.schoolId, ctx.schoolId),
            ),
          );

        if (mark) {
          studentMark = {
            marksObtained: mark.marksObtained ? parseFloat(mark.marksObtained) : null,
            feedback: mark.feedback,
            submissionStatus: mark.submissionStatus,
            markedAt: mark.markedAt,
          };
        }
      }

      const result = {
        id: assessment.id,
        subject: assessment.subject,
        maxMarks: assessment.maxMarks,
        assessmentTypeId: assessment.assessmentTypeId,
        term: {
          id: term?.id,
          name: term?.name,
          startsOn: term?.startsOn,
          endsOn: term?.endsOn,
        },
        class: {
          id: cls?.id,
          name: cls?.name,
        },
        studentMark,
        isPublished,
      };

      send(res, result);
    });
  });

  /**
   * POST /api/v1/results/publish
   * Publishes results (admin/principal only)
   */
  router.post("/publish", async (req, res) => {
    const { termId, classId, status } = parseInput(
      {
        termId: { type: "string", required: true },
        classId: { type: "string", required: false },
        status: { type: "string", required: true },
      },
      req.body,
    );

    if (!["draft", "pending_review", "approved", "published"].includes(status)) {
      throw badRequest("Invalid status value.", "validation_failed");
    }

    await inSchool(
      database,
      req,
      res,
      { roles: STAFF, capability: "results.publish" },
      async (tx, ctx) => {
        const userId = currentUserId(res);

        // Verify term exists
        const [term] = await tx
          .select()
          .from(termsTable)
          .where(and(eq(termsTable.id, termId), eq(termsTable.schoolId, ctx.schoolId)));

        if (!term) throw notFound("Term not found.");

        // Verify class if provided
        if (classId) {
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
        }

        // Check if marks are complete (if publishing)
        if (status === "published") {
          // Implement mark completion validation based on business rules
          // For now, just proceed
        }

        // Update or create publication record
        const [existing] = await tx
          .select()
          .from(resultPublicationsTable)
          .where(
            and(
              eq(resultPublicationsTable.termId, termId),
              classId ? eq(resultPublicationsTable.classId, classId) : undefined,
              eq(resultPublicationsTable.schoolId, ctx.schoolId),
            ),
          );

        const now = new Date();
        const publishedAt = status === "published" ? now : null;

        if (existing) {
          await tx
            .update(resultPublicationsTable)
            .set({
              status,
              isPublished: status === "published",
              publishedAt,
              updatedAt: now,
            })
            .where(eq(resultPublicationsTable.id, existing.id));
        } else {
          await tx.insert(resultPublicationsTable).values({
            schoolId: ctx.schoolId,
            termId,
            classId: classId || null,
            publishedByUserId: userId,
            status,
            isPublished: status === "published",
            publishedAt,
          });
        }

        send(res, { success: true, status }, 200);
      },
    );
  });

  /**
   * GET /api/v1/results/parent/child/:studentId
   * Returns published results for verified linked child (parents only)
   */
  router.get("/parent/child/:studentId", async (req, res) => {
    const { studentId } = req.params;

    await inSchool(database, req, res, GUARDIAN, async (tx, ctx) => {
      const userId = currentUserId(res);

      // Verify parent-child relationship
      const isVerified = await getParentVerifiedStudentId(tx, userId, ctx.schoolId, studentId);
      if (!isVerified) {
        throw forbidden("You do not have access to this student's records.");
      }

      // Get published marks for this student
      const marks = await tx
        .select()
        .from(studentAssessmentMarksTable)
        .innerJoin(
          assessmentsTable,
          eq(studentAssessmentMarksTable.assessmentId, assessmentsTable.id),
        )
        .innerJoin(
          resultPublicationsTable,
          and(
            eq(resultPublicationsTable.termId, assessmentsTable.termId),
            eq(resultPublicationsTable.status, "published"),
            eq(resultPublicationsTable.schoolId, ctx.schoolId),
          ),
        )
        .where(
          and(
            eq(studentAssessmentMarksTable.studentId, studentId),
            eq(studentAssessmentMarksTable.schoolId, ctx.schoolId),
          ),
        );

      const result = marks.map((m) => ({
        id: m.student_assessment_marks.id,
        subject: m.assessments.subject,
        marksObtained: m.student_assessment_marks.marksObtained
          ? parseFloat(m.student_assessment_marks.marksObtained)
          : null,
        maxMarks: m.assessments.maxMarks,
        feedback: m.student_assessment_marks.feedback,
        markedAt: m.student_assessment_marks.markedAt,
      }));

      send(res, { data: result, studentId });
    });
  });

  return router;
}

export default resultsRouter;
