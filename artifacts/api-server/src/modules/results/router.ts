import { Router } from "express";
import { and, eq, desc, inArray, sql } from "drizzle-orm";
import {
  assessmentsTable,
  classesTable,
  guardiansTable,
  studentAssessmentMarksTable,
  studentGuardiansTable,
  studentsTable,
  termsTable,
  studentTermAggregatesTable,
  resultPublicationsTable,
} from "@workspace/db/schema";
import {
  ListMyAssessmentsQueryParams,
  ListMyAssessmentsResponse,
  ListPublishedResultsQueryParams,
  ListPublishedResultsResponse,
  GetSubjectResultsParams,
  GetSubjectResultsResponse,
  GetTermResultsParams,
  GetTermResultsResponse,
  GetAssessmentResultParams,
  GetAssessmentResultResponse,
  PublishResultsBody,
  PublishResultsResponse,
  ListChildResultsParams,
  ListChildResultsResponse,
} from "@workspace/api-zod";
import { inSchool, send, currentUserId } from "../../lib/context";
import type { Tx } from "../../lib/database";
import type { AppDeps } from "../../lib/deps";
import { parseInput, badRequest, forbidden, notFound } from "../../lib/errors";
import { ANY_MEMBER, STAFF, GUARDIAN } from "../../lib/roles";

async function getStudent(tx: Tx, userId: string, schoolId: string) {
  const [student] = await tx
    .select({ id: studentsTable.id, classId: studentsTable.classId })
    .from(studentsTable)
    .where(
      and(eq(studentsTable.schoolId, schoolId), eq(studentsTable.authUserId, userId)),
    );
  return student ?? null;
}

async function isGuardianOfStudent(tx: Tx, userId: string, schoolId: string, studentId: string): Promise<boolean> {
  // A link row is created by school staff and ties the guardian record to the
  // learner; the guardian record must belong to the signed-in account here.
  const [link] = await tx
    .select({ id: studentGuardiansTable.id })
    .from(studentGuardiansTable)
    .innerJoin(guardiansTable, eq(studentGuardiansTable.guardianId, guardiansTable.id))
    .where(
      and(
        eq(studentGuardiansTable.studentId, studentId),
        eq(studentGuardiansTable.schoolId, schoolId),
        eq(guardiansTable.schoolId, schoolId),
        eq(guardiansTable.authUserId, userId),
      ),
    )
    .limit(1);
  return !!link;
}

async function isAssessmentPublished(tx: Tx, schoolId: string, termId: string, classId: string | null): Promise<boolean> {
  // Learner accounts cannot read result_publications rows (staff-only under
  // RLS); the membership-checked helper answers the publication question.
  const result = await tx.execute(
    sql`SELECT app_private.results_published(${schoolId}::uuid, ${termId}::uuid, ${classId}::uuid) AS published`,
  );
  return !!result.rows[0]?.published;
}

function toNumber(value: string | null): number | null {
  return value !== null ? parseFloat(value) : null;
}

export function resultsRouter(deps: AppDeps): Router {
  const router = Router();
  const { database } = deps;

  router.get("/my-assessments", async (req, res) => {
    const query = parseInput(ListMyAssessmentsQueryParams, req.query);

    await inSchool(database, req, res, ANY_MEMBER, async (tx, ctx) => {
      const student = await getStudent(tx, currentUserId(res), ctx.schoolId);
      if (!student) {
        throw badRequest("User is not a student in this school.", "not_a_student");
      }
      if (!student.classId) {
        throw badRequest("Student is not enrolled in a class.", "no_class");
      }

      const assessments = await tx
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
            eq(assessmentsTable.classId, student.classId),
            query.termId ? eq(assessmentsTable.termId, query.termId) : undefined,
            query.subject ? eq(assessmentsTable.subject, query.subject) : undefined,
          ),
        )
        .limit(query.limit)
        .offset(query.offset);

      const termIds = [...new Set(assessments.map((a) => a.termId))];
      const terms = termIds.length
        ? await tx
            .select({ id: termsTable.id, name: termsTable.name })
            .from(termsTable)
            .where(inArray(termsTable.id, termIds))
        : [];
      const termMap = new Map(terms.map((t) => [t.id, t.name]));

      send(res, ListMyAssessmentsResponse, {
        data: assessments.map((a) => ({
          id: a.id,
          subject: a.subject,
          maxMarks: a.maxMarks,
          termName: termMap.get(a.termId) ?? "Unknown",
        })),
        total: assessments.length,
        hasMore: false,
      });
    });
  });

  router.get("/published", async (req, res) => {
    const query = parseInput(ListPublishedResultsQueryParams, req.query);

    await inSchool(database, req, res, ANY_MEMBER, async (tx, ctx) => {
      const student = await getStudent(tx, currentUserId(res), ctx.schoolId);
      if (!student) {
        throw badRequest("User is not a student in this school.", "not_a_student");
      }

      const marks = await tx.execute(sql`
        SELECT
          sam.id,
          sam.assessment_id,
          a.subject,
          a.max_marks,
          sam.marks_obtained,
          sam.feedback,
          sam.marked_at
        FROM student_assessment_marks sam
        JOIN assessments a ON sam.assessment_id = a.id
        WHERE sam.student_id = ${student.id}
          AND sam.school_id = ${ctx.schoolId}
          AND app_private.results_published(${ctx.schoolId}::uuid, a.term_id, a.class_id)
        ORDER BY ${query.sortBy === "subject" ? sql`a.subject ASC` : sql`sam.marked_at DESC NULLS LAST`}
        LIMIT ${query.limit} OFFSET ${query.offset}
      `);

      const data = marks.rows.map((m: Record<string, unknown>) => ({
        id: m.id,
        assessmentId: m.assessment_id,
        subject: m.subject,
        maxMarks: m.max_marks,
        marksObtained: m.marks_obtained !== null ? parseFloat(m.marks_obtained as string) : null,
        feedback: m.feedback,
        markedAt: m.marked_at,
      }));

      send(res, ListPublishedResultsResponse, { data, total: data.length, hasMore: false });
    });
  });

  router.get("/by-subject/:subject", async (req, res) => {
    const { subject } = parseInput(GetSubjectResultsParams, req.params);

    await inSchool(database, req, res, ANY_MEMBER, async (tx, ctx) => {
      const student = await getStudent(tx, currentUserId(res), ctx.schoolId);
      if (!student) {
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
        .innerJoin(assessmentsTable, eq(studentAssessmentMarksTable.assessmentId, assessmentsTable.id))
        .where(
          and(
            eq(studentAssessmentMarksTable.studentId, student.id),
            eq(assessmentsTable.subject, subject),
            eq(studentAssessmentMarksTable.schoolId, ctx.schoolId),
            // Unpublished marks must never reach the learner portal.
            sql`app_private.results_published(${ctx.schoolId}::uuid, ${assessmentsTable.termId}, ${assessmentsTable.classId})`,
          ),
        )
        .orderBy(desc(studentAssessmentMarksTable.markedAt));

      send(res, GetSubjectResultsResponse, {
        data: marks.map((m) => ({
          id: m.id,
          assessmentId: m.assessmentId,
          marksObtained: toNumber(m.marksObtained),
          feedback: m.feedback,
          markedAt: m.markedAt,
        })),
        subject,
        averageTrend: null,
      });
    });
  });

  router.get("/term/:termId", async (req, res) => {
    const { termId } = parseInput(GetTermResultsParams, req.params);

    await inSchool(database, req, res, ANY_MEMBER, async (tx, ctx) => {
      const student = await getStudent(tx, currentUserId(res), ctx.schoolId);
      if (!student) {
        throw badRequest("User is not a student in this school.", "not_a_student");
      }

      const [term] = await tx
        .select()
        .from(termsTable)
        .where(and(eq(termsTable.id, termId), eq(termsTable.schoolId, ctx.schoolId)));
      if (!term) throw notFound("Term not found.");

      if (!(await isAssessmentPublished(tx, ctx.schoolId, termId, student.classId))) {
        throw forbidden("Results for this term have not been published yet.");
      }

      const aggregates = await tx
        .select()
        .from(studentTermAggregatesTable)
        .where(
          and(
            eq(studentTermAggregatesTable.studentId, student.id),
            eq(studentTermAggregatesTable.termId, termId),
            eq(studentTermAggregatesTable.schoolId, ctx.schoolId),
          ),
        );

      const subjectResults = aggregates.map((s) => ({
        subject: s.subject,
        totalMarks: toNumber(s.totalMarks),
        averagePercentage: toNumber(s.averagePercentage),
        grade: s.grade,
        position: s.positionInClass,
      }));
      const percentages = subjectResults
        .map((s) => s.averagePercentage)
        .filter((p): p is number => p !== null);

      send(res, GetTermResultsResponse, {
        termId: term.id,
        termName: term.name,
        termData: { startsOn: term.startsOn, endsOn: term.endsOn },
        subjectResults,
        overallAverage: percentages.length
          ? parseFloat((percentages.reduce((sum, p) => sum + p, 0) / percentages.length).toFixed(2))
          : null,
        classPosition: subjectResults[0]?.position ?? null,
      });
    });
  });

  router.get("/assessment/:assessmentId", async (req, res) => {
    const { assessmentId } = parseInput(GetAssessmentResultParams, req.params);

    await inSchool(database, req, res, ANY_MEMBER, async (tx, ctx) => {
      const student = await getStudent(tx, currentUserId(res), ctx.schoolId);
      if (!student) {
        throw badRequest("User is not a student in this school.", "not_a_student");
      }

      const [assessment] = await tx
        .select()
        .from(assessmentsTable)
        .where(
          and(eq(assessmentsTable.id, assessmentId), eq(assessmentsTable.schoolId, ctx.schoolId)),
        );
      if (!assessment) throw notFound("Assessment not found.");

      const isPublished = await isAssessmentPublished(tx, ctx.schoolId, assessment.termId, assessment.classId);

      const [term] = await tx.select().from(termsTable).where(eq(termsTable.id, assessment.termId));
      const [cls] = await tx.select().from(classesTable).where(eq(classesTable.id, assessment.classId));
      if (!term || !cls) throw notFound("Assessment not found.");

      let studentMark = null;
      if (isPublished) {
        const [mark] = await tx
          .select()
          .from(studentAssessmentMarksTable)
          .where(
            and(
              eq(studentAssessmentMarksTable.assessmentId, assessmentId),
              eq(studentAssessmentMarksTable.studentId, student.id),
              eq(studentAssessmentMarksTable.schoolId, ctx.schoolId),
            ),
          );
        if (mark) {
          studentMark = {
            marksObtained: toNumber(mark.marksObtained),
            feedback: mark.feedback,
            submissionStatus: mark.submissionStatus,
            markedAt: mark.markedAt,
          };
        }
      }

      send(res, GetAssessmentResultResponse, {
        id: assessment.id,
        subject: assessment.subject,
        maxMarks: assessment.maxMarks,
        assessmentTypeId: assessment.assessmentTypeId,
        term: { id: term.id, name: term.name, startsOn: term.startsOn, endsOn: term.endsOn },
        class: { id: cls.id, name: cls.name },
        studentMark,
        isPublished,
      });
    });
  });

  router.post("/publish", async (req, res) => {
    const input = parseInput(PublishResultsBody, req.body);

    await inSchool(
      database,
      req,
      res,
      { roles: STAFF, capability: "results.publish" },
      async (tx, ctx) => {
        const [term] = await tx
          .select({ id: termsTable.id })
          .from(termsTable)
          .where(and(eq(termsTable.id, input.termId), eq(termsTable.schoolId, ctx.schoolId)));
        if (!term) throw notFound("Term not found.");

        if (input.classId) {
          const [cls] = await tx
            .select({ id: classesTable.id })
            .from(classesTable)
            .where(and(eq(classesTable.id, input.classId), eq(classesTable.schoolId, ctx.schoolId)));
          if (!cls) throw notFound("Class not found.");
        }

        const [existing] = await tx
          .select({ id: resultPublicationsTable.id })
          .from(resultPublicationsTable)
          .where(
            and(
              eq(resultPublicationsTable.termId, input.termId),
              input.classId ? eq(resultPublicationsTable.classId, input.classId) : undefined,
              eq(resultPublicationsTable.schoolId, ctx.schoolId),
            ),
          );

        const now = new Date();
        const isPublished = input.status === "published";
        const values = {
          status: input.status,
          isPublished,
          publishedAt: isPublished ? now : null,
          updatedAt: now,
        };

        if (existing) {
          await tx
            .update(resultPublicationsTable)
            .set(values)
            .where(eq(resultPublicationsTable.id, existing.id));
        } else {
          await tx.insert(resultPublicationsTable).values({
            schoolId: ctx.schoolId,
            termId: input.termId,
            classId: input.classId ?? null,
            publishedByUserId: ctx.userId,
            ...values,
          });
        }

        send(res, PublishResultsResponse, { success: true, status: input.status });
      },
    );
  });

  router.get("/parent/child/:studentId", async (req, res) => {
    const { studentId } = parseInput(ListChildResultsParams, req.params);

    await inSchool(database, req, res, GUARDIAN, async (tx, ctx) => {
      const userId = currentUserId(res);
      if (!(await isGuardianOfStudent(tx, userId, ctx.schoolId, studentId))) {
        throw forbidden("You do not have access to this student's records.");
      }

      const marks = await tx
        .select()
        .from(studentAssessmentMarksTable)
        .innerJoin(assessmentsTable, eq(studentAssessmentMarksTable.assessmentId, assessmentsTable.id))
        .where(
          and(
            eq(studentAssessmentMarksTable.studentId, studentId),
            eq(studentAssessmentMarksTable.schoolId, ctx.schoolId),
            sql`app_private.results_published(${ctx.schoolId}::uuid, ${assessmentsTable.termId}, ${assessmentsTable.classId})`,
          ),
        );

      send(res, ListChildResultsResponse, {
        data: marks.map((m) => ({
          id: m.student_assessment_marks.id,
          subject: m.assessments.subject,
          marksObtained: toNumber(m.student_assessment_marks.marksObtained),
          maxMarks: m.assessments.maxMarks,
          feedback: m.student_assessment_marks.feedback,
          markedAt: m.student_assessment_marks.markedAt,
        })),
        studentId,
      });
    });
  });

  return router;
}

export default resultsRouter;