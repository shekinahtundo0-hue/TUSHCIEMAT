import { and, asc, count, eq, ilike, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import {
  classesTable,
  guardiansTable,
  studentGuardiansTable,
  studentsTable,
  type GuardianRelationship,
} from "@workspace/db/schema";
import type { Tx } from "../../lib/database";
import { audit, type SchoolContext } from "../../lib/context";
import { badRequest, conflict, isUniqueViolation, notFound } from "../../lib/errors";
import { GUARDIAN_VIEWERS, hasAny } from "../../lib/roles";
import { assignedClassesOnly } from "../../lib/scope";

type StudentStatus = "active" | "transferred" | "graduated" | "inactive";

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function guardianCountColumn(ctx: SchoolContext) {
  // Only roles that can read guardian links get a count; others get null
  // rather than a misleading zero.
  return hasAny(ctx.roles, GUARDIAN_VIEWERS)
    ? sql<number | null>`(select count(*)::int from ${studentGuardiansTable}
        where ${studentGuardiansTable.studentId} = ${studentsTable.id}
          and ${studentGuardiansTable.schoolId} = ${ctx.schoolId})`
    : sql<number | null>`null::int`;
}

function studentColumns(ctx: SchoolContext) {
  return {
    id: studentsTable.id,
    firstName: studentsTable.firstName,
    lastName: studentsTable.lastName,
    admissionNumber: studentsTable.admissionNumber,
    classId: studentsTable.classId,
    className: classesTable.name,
    status: studentsTable.status,
    hasAccount: sql<boolean>`${studentsTable.authUserId} is not null`,
    guardianCount: guardianCountColumn(ctx),
    createdAt: studentsTable.createdAt,
  };
}

async function findStudent(tx: Tx, ctx: SchoolContext, studentId: string) {
  const [student] = await tx
    .select(studentColumns(ctx))
    .from(studentsTable)
    .leftJoin(classesTable, eq(classesTable.id, studentsTable.classId))
    .where(
      and(
        eq(studentsTable.id, studentId),
        eq(studentsTable.schoolId, ctx.schoolId),
        assignedClassesOnly(ctx, studentsTable.classId, GUARDIAN_VIEWERS),
      ),
    );
  if (!student) throw notFound("Student not found.");
  return student;
}

export async function listStudents(
  tx: Tx,
  ctx: SchoolContext,
  query: { search?: string; classId?: string; page: number; pageSize: number },
) {
  const filters: Array<SQL | undefined> = [
    eq(studentsTable.schoolId, ctx.schoolId),
    assignedClassesOnly(ctx, studentsTable.classId, GUARDIAN_VIEWERS),
  ];
  if (query.classId) filters.push(eq(studentsTable.classId, query.classId));
  const search = query.search?.trim();
  if (search) {
    const pattern = `%${escapeLike(search)}%`;
    filters.push(
      or(
        ilike(studentsTable.firstName, pattern),
        ilike(studentsTable.lastName, pattern),
        ilike(studentsTable.admissionNumber, pattern),
        ilike(sql`${studentsTable.firstName} || ' ' || ${studentsTable.lastName}`, pattern),
      ),
    );
  }
  const where = and(...filters);

  const [{ total }] = await tx.select({ total: count() }).from(studentsTable).where(where);
  const items = await tx
    .select(studentColumns(ctx))
    .from(studentsTable)
    .leftJoin(classesTable, eq(classesTable.id, studentsTable.classId))
    .where(where)
    .orderBy(asc(studentsTable.lastName), asc(studentsTable.firstName), asc(studentsTable.admissionNumber))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);

  return { items, total: Number(total), page: query.page, pageSize: query.pageSize };
}

export async function createStudent(
  tx: Tx,
  ctx: SchoolContext,
  input: {
    firstName: string;
    lastName: string;
    admissionNumber: string;
    classId?: string | null;
    status: StudentStatus;
  },
) {
  try {
    const [student] = await tx
      .insert(studentsTable)
      .values({
        schoolId: ctx.schoolId,
        classId: input.classId ?? null,
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
        admissionNumber: input.admissionNumber.trim(),
        status: input.status,
      })
      .returning({ id: studentsTable.id });
    await audit(tx, ctx, "student.created", "student", student.id);
    return findStudent(tx, ctx, student.id);
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict("A student with that admission number already exists.");
    throw error;
  }
}

async function guardianLinks(tx: Tx, ctx: SchoolContext, studentId: string) {
  return tx
    .select({
      guardianId: guardiansTable.id,
      fullName: guardiansTable.fullName,
      email: guardiansTable.email,
      phone: guardiansTable.phone,
      relationship: studentGuardiansTable.relationship,
      isPrimary: studentGuardiansTable.isPrimary,
      hasAccount: sql<boolean>`${guardiansTable.authUserId} is not null`,
    })
    .from(studentGuardiansTable)
    .innerJoin(guardiansTable, eq(guardiansTable.id, studentGuardiansTable.guardianId))
    .where(
      and(
        eq(studentGuardiansTable.studentId, studentId),
        eq(studentGuardiansTable.schoolId, ctx.schoolId),
      ),
    )
    .orderBy(sql`${studentGuardiansTable.isPrimary} desc`, asc(guardiansTable.fullName));
}

export async function getStudent(tx: Tx, ctx: SchoolContext, studentId: string) {
  const student = await findStudent(tx, ctx, studentId);
  const guardians = hasAny(ctx.roles, GUARDIAN_VIEWERS) ? await guardianLinks(tx, ctx, studentId) : null;
  return { ...student, guardians };
}

export async function updateStudent(
  tx: Tx,
  ctx: SchoolContext,
  studentId: string,
  input: {
    firstName?: string;
    lastName?: string;
    admissionNumber?: string;
    classId?: string | null;
    status?: StudentStatus;
  },
) {
  const changes = {
    ...(input.firstName !== undefined && { firstName: input.firstName.trim() }),
    ...(input.lastName !== undefined && { lastName: input.lastName.trim() }),
    ...(input.admissionNumber !== undefined && { admissionNumber: input.admissionNumber.trim() }),
    ...(input.classId !== undefined && { classId: input.classId }),
    ...(input.status !== undefined && { status: input.status }),
  };
  if (Object.keys(changes).length === 0) throw badRequest("Nothing to update.", "validation_failed");

  try {
    const updated = await tx
      .update(studentsTable)
      .set(changes)
      .where(and(eq(studentsTable.id, studentId), eq(studentsTable.schoolId, ctx.schoolId)))
      .returning({ id: studentsTable.id });
    if (updated.length === 0) throw notFound("Student not found.");
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict("A student with that admission number already exists.");
    throw error;
  }
  await audit(tx, ctx, "student.updated", "student", studentId, { fields: Object.keys(changes) });
  return findStudent(tx, ctx, studentId);
}

function normalizePhone(phone: string | null | undefined): string | null {
  const digits = phone?.replace(/\s+/g, "");
  return digits ? digits : null;
}

function sameName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export async function addGuardian(
  tx: Tx,
  ctx: SchoolContext,
  studentId: string,
  input: {
    fullName: string;
    email?: string | null;
    phone?: string | null;
    relationship: GuardianRelationship;
    isPrimary: boolean;
  },
) {
  await findStudent(tx, ctx, studentId);
  const email = input.email?.trim().toLowerCase() || null;
  const phone = normalizePhone(input.phone);

  // Reuse a guardian already on file so siblings share one parent record
  // (and, once invited, one parent account).
  const match = email
    ? eq(guardiansTable.email, email)
    : phone
      ? and(eq(guardiansTable.phone, phone), isNull(guardiansTable.email))
      : undefined;
  let [guardian] = match
    ? await tx
        .select()
        .from(guardiansTable)
        .where(and(eq(guardiansTable.schoolId, ctx.schoolId), match))
        .orderBy(asc(guardiansTable.createdAt))
        .limit(1)
    : [];

  if (!guardian) {
    [guardian] = await tx
      .insert(guardiansTable)
      .values({ schoolId: ctx.schoolId, fullName: input.fullName.trim(), email, phone })
      .returning();
  } else if (sameName(guardian.fullName) !== sameName(input.fullName)) {
    // A typo in the email must not silently attach the child to someone
    // else's parent account.
    throw conflict(
      `${email ? "That email" : "That phone number"} already belongs to ${guardian.fullName}. Check the details, or use the same name to link the existing guardian.`,
    );
  }

  const [existingLink] = await tx
    .select({ id: studentGuardiansTable.id })
    .from(studentGuardiansTable)
    .where(
      and(
        eq(studentGuardiansTable.schoolId, ctx.schoolId),
        eq(studentGuardiansTable.studentId, studentId),
        eq(studentGuardiansTable.guardianId, guardian.id),
      ),
    );
  if (existingLink) throw conflict("This guardian is already linked to the student.");

  if (input.isPrimary) {
    await tx
      .update(studentGuardiansTable)
      .set({ isPrimary: false })
      .where(
        and(
          eq(studentGuardiansTable.schoolId, ctx.schoolId),
          eq(studentGuardiansTable.studentId, studentId),
          ne(studentGuardiansTable.guardianId, guardian.id),
        ),
      );
  }

  await tx.insert(studentGuardiansTable).values({
    schoolId: ctx.schoolId,
    studentId,
    guardianId: guardian.id,
    relationship: input.relationship,
    isPrimary: input.isPrimary,
  });
  await audit(tx, ctx, "student.guardian_linked", "student", studentId, { guardianId: guardian.id });

  return {
    guardianId: guardian.id,
    fullName: guardian.fullName,
    email: guardian.email,
    phone: guardian.phone,
    relationship: input.relationship,
    isPrimary: input.isPrimary,
    hasAccount: guardian.authUserId !== null,
  };
}

export async function removeGuardian(
  tx: Tx,
  ctx: SchoolContext,
  studentId: string,
  guardianId: string,
): Promise<void> {
  const removed = await tx
    .delete(studentGuardiansTable)
    .where(
      and(
        eq(studentGuardiansTable.schoolId, ctx.schoolId),
        eq(studentGuardiansTable.studentId, studentId),
        eq(studentGuardiansTable.guardianId, guardianId),
      ),
    )
    .returning({ id: studentGuardiansTable.id });
  if (removed.length === 0) throw notFound("That guardian is not linked to this student.");
  await audit(tx, ctx, "student.guardian_unlinked", "student", studentId, { guardianId });
}
