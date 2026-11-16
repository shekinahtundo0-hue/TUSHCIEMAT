import { and, asc, desc, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import {
  academicYearsTable,
  classTeacherAssignmentsTable,
  classesTable,
  studentsTable,
  termsTable,
  type AcademicYear,
  type Term,
} from "@workspace/db/schema";
import type { Tx } from "../../lib/database";
import { audit, type SchoolContext } from "../../lib/context";
import { isCalendarDate } from "../../lib/dates";
import { badRequest, conflict, isUniqueViolation, notFound } from "../../lib/errors";
import { GUARDIAN_VIEWERS } from "../../lib/roles";
import { assignedClassesOnly } from "../../lib/scope";

interface DateRange {
  name: string;
  startsOn: string;
  endsOn: string;
}

export function assertDateRange(startsOn: string, endsOn: string): void {
  if (!isCalendarDate(startsOn) || !isCalendarDate(endsOn)) {
    throw badRequest("Dates must be real calendar dates (YYYY-MM-DD).", "validation_failed");
  }
  if (endsOn <= startsOn) {
    throw badRequest("The end date must be after the start date.", "validation_failed");
  }
}

function toTerm(term: Term) {
  return {
    id: term.id,
    academicYearId: term.academicYearId,
    name: term.name,
    startsOn: term.startsOn,
    endsOn: term.endsOn,
    isCurrent: term.isCurrent,
  };
}

function toYear(year: AcademicYear, terms: Term[]) {
  return {
    id: year.id,
    name: year.name,
    startsOn: year.startsOn,
    endsOn: year.endsOn,
    isCurrent: year.isCurrent,
    terms: terms.filter((term) => term.academicYearId === year.id).map(toTerm),
  };
}

async function findYear(tx: Tx, ctx: SchoolContext, academicYearId: string): Promise<AcademicYear> {
  const [year] = await tx
    .select()
    .from(academicYearsTable)
    .where(and(eq(academicYearsTable.id, academicYearId), eq(academicYearsTable.schoolId, ctx.schoolId)));
  if (!year) throw notFound("Academic year not found.");
  return year;
}

async function yearTerms(tx: Tx, ctx: SchoolContext, academicYearId?: string): Promise<Term[]> {
  return tx
    .select()
    .from(termsTable)
    .where(
      and(
        eq(termsTable.schoolId, ctx.schoolId),
        academicYearId ? eq(termsTable.academicYearId, academicYearId) : undefined,
      ),
    )
    .orderBy(asc(termsTable.startsOn));
}

export async function listAcademicYears(tx: Tx, ctx: SchoolContext) {
  const years = await tx
    .select()
    .from(academicYearsTable)
    .where(eq(academicYearsTable.schoolId, ctx.schoolId))
    .orderBy(desc(academicYearsTable.startsOn));
  const terms = await yearTerms(tx, ctx);
  return years.map((year) => toYear(year, terms));
}

export async function createAcademicYear(tx: Tx, ctx: SchoolContext, input: DateRange) {
  assertDateRange(input.startsOn, input.endsOn);
  try {
    const [year] = await tx
      .insert(academicYearsTable)
      .values({
        schoolId: ctx.schoolId,
        name: input.name.trim(),
        startsOn: input.startsOn,
        endsOn: input.endsOn,
      })
      .returning();
    await audit(tx, ctx, "academic_year.created", "academic_year", year.id);
    return toYear(year, []);
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict("An academic year with that name already exists.");
    throw error;
  }
}

async function makeYearCurrent(tx: Tx, ctx: SchoolContext, year: AcademicYear): Promise<void> {
  if (year.isCurrent) return;
  // Clear the old current year (and its current term) before setting the
  // new one; partial unique indexes allow one current year/term per school.
  await tx
    .update(termsTable)
    .set({ isCurrent: false })
    .where(
      and(
        eq(termsTable.schoolId, ctx.schoolId),
        eq(termsTable.isCurrent, true),
        ne(termsTable.academicYearId, year.id),
      ),
    );
  await tx
    .update(academicYearsTable)
    .set({ isCurrent: false })
    .where(and(eq(academicYearsTable.schoolId, ctx.schoolId), eq(academicYearsTable.isCurrent, true)));
  await tx
    .update(academicYearsTable)
    .set({ isCurrent: true })
    .where(and(eq(academicYearsTable.id, year.id), eq(academicYearsTable.schoolId, ctx.schoolId)));
}

export async function setCurrentAcademicYear(tx: Tx, ctx: SchoolContext, academicYearId: string) {
  const year = await findYear(tx, ctx, academicYearId);
  await makeYearCurrent(tx, ctx, year);
  await audit(tx, ctx, "academic_year.made_current", "academic_year", year.id);
  return toYear({ ...year, isCurrent: true }, await yearTerms(tx, ctx, year.id));
}

export async function createTerm(tx: Tx, ctx: SchoolContext, academicYearId: string, input: DateRange) {
  const year = await findYear(tx, ctx, academicYearId);
  assertDateRange(input.startsOn, input.endsOn);
  if (input.startsOn < year.startsOn || input.endsOn > year.endsOn) {
    throw badRequest(
      `Term dates must fall within ${year.name} (${year.startsOn} to ${year.endsOn}).`,
      "validation_failed",
    );
  }

  const [overlap] = await tx
    .select({ name: termsTable.name })
    .from(termsTable)
    .where(
      and(
        eq(termsTable.schoolId, ctx.schoolId),
        eq(termsTable.academicYearId, year.id),
        lte(termsTable.startsOn, input.endsOn),
        gte(termsTable.endsOn, input.startsOn),
      ),
    );
  if (overlap) throw conflict(`These dates overlap ${overlap.name}.`);

  try {
    const [term] = await tx
      .insert(termsTable)
      .values({
        schoolId: ctx.schoolId,
        academicYearId: year.id,
        name: input.name.trim(),
        startsOn: input.startsOn,
        endsOn: input.endsOn,
      })
      .returning();
    await audit(tx, ctx, "term.created", "term", term.id);
    return toTerm(term);
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict("A term with that name already exists in this year.");
    throw error;
  }
}

export async function setCurrentTerm(tx: Tx, ctx: SchoolContext, termId: string) {
  const [term] = await tx
    .select()
    .from(termsTable)
    .where(and(eq(termsTable.id, termId), eq(termsTable.schoolId, ctx.schoolId)));
  if (!term) throw notFound("Term not found.");

  await makeYearCurrent(tx, ctx, await findYear(tx, ctx, term.academicYearId));
  await tx
    .update(termsTable)
    .set({ isCurrent: false })
    .where(and(eq(termsTable.schoolId, ctx.schoolId), eq(termsTable.isCurrent, true)));
  await tx
    .update(termsTable)
    .set({ isCurrent: true })
    .where(and(eq(termsTable.id, term.id), eq(termsTable.schoolId, ctx.schoolId)));
  await audit(tx, ctx, "term.made_current", "term", term.id);
  return toTerm({ ...term, isCurrent: true });
}

async function teachersFor(tx: Tx, ctx: SchoolContext, classIds: string[]) {
  if (classIds.length === 0) return [];
  return tx
    .select({
      id: classTeacherAssignmentsTable.id,
      classId: classTeacherAssignmentsTable.classId,
      teacherUserId: classTeacherAssignmentsTable.teacherUserId,
      teacherName: sql<string | null>`school_people.full_name`,
      assignmentRole: classTeacherAssignmentsTable.assignmentRole,
      subject: classTeacherAssignmentsTable.subject,
    })
    .from(classTeacherAssignmentsTable)
    .leftJoin(
      sql`app_private.school_people(${ctx.schoolId}::uuid) as school_people`,
      sql`school_people.auth_user_id = ${classTeacherAssignmentsTable.teacherUserId}`,
    )
    .where(
      and(
        eq(classTeacherAssignmentsTable.schoolId, ctx.schoolId),
        inArray(classTeacherAssignmentsTable.classId, classIds),
      ),
    )
    .orderBy(asc(classTeacherAssignmentsTable.assignmentRole), asc(classTeacherAssignmentsTable.subject));
}

export async function listClasses(tx: Tx, ctx: SchoolContext) {
  const studentCount = tx
    .select({
      classId: studentsTable.classId,
      total: sql<number>`count(*)::int`.as("total"),
    })
    .from(studentsTable)
    .where(and(eq(studentsTable.schoolId, ctx.schoolId), eq(studentsTable.status, "active")))
    .groupBy(studentsTable.classId)
    .as("student_count");

  const classes = await tx
    .select({
      id: classesTable.id,
      name: classesTable.name,
      grade: classesTable.grade,
      stream: classesTable.stream,
      academicYearId: classesTable.academicYearId,
      academicYear: academicYearsTable.name,
      studentCount: sql<number>`coalesce(${studentCount.total}, 0)`,
    })
    .from(classesTable)
    .innerJoin(academicYearsTable, eq(academicYearsTable.id, classesTable.academicYearId))
    .leftJoin(studentCount, eq(studentCount.classId, classesTable.id))
    .where(and(eq(classesTable.schoolId, ctx.schoolId), assignedClassesOnly(ctx, classesTable.id, GUARDIAN_VIEWERS)))
    .orderBy(desc(academicYearsTable.startsOn), asc(classesTable.grade), asc(classesTable.name));

  const teachers = await teachersFor(tx, ctx, classes.map((item) => item.id));
  return classes.map((item) => ({
    ...item,
    studentCount: Number(item.studentCount),
    teachers: teachers.filter((teacher) => teacher.classId === item.id),
  }));
}

export async function createClass(
  tx: Tx,
  ctx: SchoolContext,
  input: { name: string; grade: string; stream?: string | null; academicYearId: string },
) {
  const [year] = await tx
    .select()
    .from(academicYearsTable)
    .where(and(eq(academicYearsTable.id, input.academicYearId), eq(academicYearsTable.schoolId, ctx.schoolId)));
  if (!year) throw badRequest("Choose an academic year of this school.", "validation_failed");
  try {
    const [created] = await tx
      .insert(classesTable)
      .values({
        schoolId: ctx.schoolId,
        academicYearId: year.id,
        name: input.name.trim(),
        grade: input.grade.trim(),
        stream: input.stream?.trim() || null,
      })
      .returning();
    await audit(tx, ctx, "class.created", "class", created.id);
    return { ...created, academicYear: year.name, studentCount: 0, teachers: [] };
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict("A class with that name already exists in this academic year.");
    throw error;
  }
}

export async function assignTeacher(
  tx: Tx,
  ctx: SchoolContext,
  classId: string,
  input: {
    teacherUserId: string;
    assignmentRole: "class_teacher" | "subject_teacher";
    subject?: string | null;
  },
) {
  const subject = input.subject?.trim() || null;
  if (input.assignmentRole === "subject_teacher" && !subject) {
    throw badRequest("A subject teacher needs a subject.", "validation_failed");
  }
  if (input.assignmentRole === "class_teacher" && subject) {
    throw badRequest("A class teacher assignment does not take a subject.", "validation_failed");
  }

  const [found] = await tx
    .select({ id: classesTable.id })
    .from(classesTable)
    .where(and(eq(classesTable.id, classId), eq(classesTable.schoolId, ctx.schoolId)));
  if (!found) throw notFound("Class not found.");

  try {
    const [assignment] = await tx
      .insert(classTeacherAssignmentsTable)
      .values({
        schoolId: ctx.schoolId,
        classId,
        teacherUserId: input.teacherUserId,
        assignmentRole: input.assignmentRole,
        subject,
        createdByUserId: ctx.userId,
      })
      .returning();
    const profiles = await tx.execute<{ full_name: string | null }>(sql`
      select full_name from app_private.school_people(${ctx.schoolId}::uuid) where auth_user_id = ${assignment.teacherUserId}
    `);
    const profile = profiles.rows[0];
    await audit(tx, ctx, "class.teacher_assigned", "class", classId, {
      assignmentId: assignment.id,
      teacherUserId: assignment.teacherUserId,
      assignmentRole: assignment.assignmentRole,
    });
    return { ...assignment, teacherName: profile?.full_name ?? null };
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw conflict(
        input.assignmentRole === "class_teacher"
          ? "This class already has a class teacher, or this teacher is already assigned."
          : "This teacher is already assigned to that subject in this class.",
      );
    }
    throw error;
  }
}

export async function removeTeacherAssignment(
  tx: Tx,
  ctx: SchoolContext,
  classId: string,
  assignmentId: string,
): Promise<void> {
  const removed = await tx
    .delete(classTeacherAssignmentsTable)
    .where(
      and(
        eq(classTeacherAssignmentsTable.id, assignmentId),
        eq(classTeacherAssignmentsTable.classId, classId),
        eq(classTeacherAssignmentsTable.schoolId, ctx.schoolId),
      ),
    )
    .returning({ id: classTeacherAssignmentsTable.id });
  if (removed.length === 0) throw notFound("Assignment not found.");
  await audit(tx, ctx, "class.teacher_removed", "class", classId, { assignmentId });
}
