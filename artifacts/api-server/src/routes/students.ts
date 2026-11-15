import { and, asc, count, eq, ilike, inArray, or } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateStudentBody,
  CreateStudentResponse,
  ListStudentsQueryParams,
  ListStudentsResponse,
  UpdateStudentBody,
  UpdateStudentParams,
  UpdateStudentResponse,
} from "@workspace/api-zod";
import {
  classesTable,
  studentsTable,
} from "@workspace/db";
import {
  SchoolAccessError,
  withSchoolAccess,
  writeAuditLog,
  type Transaction,
} from "../lib/schoolAccess";

const router: IRouter = Router();
const SCHOOL_STAFF = [
  "owner",
  "school_admin",
  "principal",
  "academic_admin",
] as const;

async function getStudent(
  tx: Transaction,
  id: string,
  schoolId: string,
) {
  const [row] = await tx
    .select({
      id: studentsTable.id,
      firstName: studentsTable.firstName,
      lastName: studentsTable.lastName,
      admissionNumber: studentsTable.admissionNumber,
      classId: studentsTable.classId,
      className: classesTable.name,
      guardianName: studentsTable.guardianName,
      guardianEmail: studentsTable.guardianEmail,
      guardianPhone: studentsTable.guardianPhone,
      status: studentsTable.status,
      createdAt: studentsTable.createdAt,
    })
    .from(studentsTable)
    .leftJoin(classesTable, eq(studentsTable.classId, classesTable.id))
    .where(
      and(
        eq(studentsTable.id, id),
        eq(studentsTable.schoolId, schoolId),
      ),
    )
    .limit(1);
  return row;
}

router.get("/students", async (req, res): Promise<void> => {
  const query = ListStudentsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: "Check the student search filters." });
    return;
  }
  const userId = res.locals.userId;
  if (!userId) {
    res.status(401).json({ error: "Sign in is required." });
    return;
  }

  const { search, classId, page = 1, pageSize = 20 } = query.data;
  const result = await withSchoolAccess(userId, SCHOOL_STAFF, async (tx, membership) => {
    const searchValue = search?.trim();
    const where = and(
      eq(studentsTable.schoolId, membership.schoolId),
      classId ? eq(studentsTable.classId, classId) : undefined,
      searchValue
        ? or(
            ilike(studentsTable.firstName, `%${searchValue}%`),
            ilike(studentsTable.lastName, `%${searchValue}%`),
            ilike(studentsTable.admissionNumber, `%${searchValue}%`),
          )
        : undefined,
    );
    const [total] = await tx
      .select({ value: count() })
      .from(studentsTable)
      .where(where);
    const rows = await tx
      .select({
        id: studentsTable.id,
        firstName: studentsTable.firstName,
        lastName: studentsTable.lastName,
        admissionNumber: studentsTable.admissionNumber,
        classId: studentsTable.classId,
      className: classesTable.name,
        guardianName: studentsTable.guardianName,
        guardianEmail: studentsTable.guardianEmail,
        guardianPhone: studentsTable.guardianPhone,
        status: studentsTable.status,
        createdAt: studentsTable.createdAt,
      })
      .from(studentsTable)
      .leftJoin(classesTable, eq(studentsTable.classId, classesTable.id))
      .where(where)
      .orderBy(asc(studentsTable.lastName), asc(studentsTable.firstName))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    return {
      items: rows,
      total: Number(total.value),
      page,
      pageSize,
    };
  });
  res.json(ListStudentsResponse.parse(result));
});

router.post("/students", async (req, res): Promise<void> => {
  const parsed = CreateStudentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Check the student details and try again." });
    return;
  }
  const userId = res.locals.userId;
  if (!userId) {
    res.status(401).json({ error: "Sign in is required." });
    return;
  }

  const student = await withSchoolAccess(userId, SCHOOL_STAFF, async (tx, membership) => {
    const classId = parsed.data.classId ?? null;
    if (classId) {
      const [schoolClass] = await tx
        .select({ id: classesTable.id })
        .from(classesTable)
        .where(
          and(
            eq(classesTable.id, classId),
            eq(classesTable.schoolId, membership.schoolId),
          ),
        )
        .limit(1);
      if (!schoolClass) {
        throw new SchoolAccessError("Choose a class from this school.", 400);
      }
    }
    const [created] = await tx
      .insert(studentsTable)
      .values({
        schoolId: membership.schoolId,
        classId,
        firstName: parsed.data.firstName.trim(),
        lastName: parsed.data.lastName.trim(),
        admissionNumber: parsed.data.admissionNumber.trim(),
        guardianName: parsed.data.guardianName?.trim() || null,
        guardianEmail: parsed.data.guardianEmail?.trim() || null,
        guardianPhone: parsed.data.guardianPhone?.trim() || null,
        status: parsed.data.status,
      })
      .returning({ id: studentsTable.id });
    await writeAuditLog(
      tx,
      membership.schoolId,
      userId,
      "student.created",
      "student",
      created.id,
    );
    return getStudent(tx, created.id, membership.schoolId);
  });
  res.status(201).json(CreateStudentResponse.parse(student));
});

router.patch("/students/:studentId", async (req, res): Promise<void> => {
  const params = UpdateStudentParams.safeParse(req.params);
  const parsed = UpdateStudentBody.safeParse(req.body);
  if (!params.success || !parsed.success || Object.keys(parsed.data ?? {}).length === 0) {
    res.status(400).json({ error: "Check the student details and try again." });
    return;
  }
  const userId = res.locals.userId;
  if (!userId) {
    res.status(401).json({ error: "Sign in is required." });
    return;
  }

  const student = await withSchoolAccess(userId, SCHOOL_STAFF, async (tx, membership) => {
    const current = await getStudent(tx, params.data.studentId, membership.schoolId);
    if (!current) {
      throw new SchoolAccessError("Student not found in this school.", 404);
    }

    if (parsed.data.classId) {
      const [schoolClass] = await tx
        .select({ id: classesTable.id })
        .from(classesTable)
        .where(
          and(
            eq(classesTable.id, parsed.data.classId),
            eq(classesTable.schoolId, membership.schoolId),
          ),
        )
        .limit(1);
      if (!schoolClass) {
        throw new SchoolAccessError("Choose a class from this school.", 400);
      }
    }

    const [updated] = await tx
      .update(studentsTable)
      .set({
        ...parsed.data,
        firstName: parsed.data.firstName?.trim(),
        lastName: parsed.data.lastName?.trim(),
        admissionNumber: parsed.data.admissionNumber?.trim(),
        guardianName:
          parsed.data.guardianName === undefined
            ? undefined
            : parsed.data.guardianName?.trim() || null,
        guardianEmail:
          parsed.data.guardianEmail === undefined
            ? undefined
            : parsed.data.guardianEmail?.trim() || null,
        guardianPhone:
          parsed.data.guardianPhone === undefined
            ? undefined
            : parsed.data.guardianPhone?.trim() || null,
      })
      .where(
        and(
          eq(studentsTable.id, params.data.studentId),
          eq(studentsTable.schoolId, membership.schoolId),
        ),
      )
      .returning({ id: studentsTable.id });
    if (!updated) {
      throw new SchoolAccessError("Student not found in this school.", 404);
    }
    await writeAuditLog(
      tx,
      membership.schoolId,
      userId,
      "student.updated",
      "student",
      updated.id,
    );
    return getStudent(tx, updated.id, membership.schoolId);
  });
  res.json(UpdateStudentResponse.parse(student));
});

export default router;
