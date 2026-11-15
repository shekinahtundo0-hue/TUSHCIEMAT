import { and, asc, eq, inArray } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  ListAttendanceQueryParams,
  ListAttendanceResponse,
  SaveAttendanceBody,
  SaveAttendanceResponse,
} from "@workspace/api-zod";
import {
  attendanceRecordsTable,
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

function calendarDate(value: Date | string): string {
  if (typeof value === "string") return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

async function getRegister(
  tx: Transaction,
  schoolId: string,
  date: string,
  classId?: string,
) {
  return tx
    .select({
      id: attendanceRecordsTable.id,
      studentId: studentsTable.id,
      firstName: studentsTable.firstName,
      admissionNumber: studentsTable.admissionNumber,
      classId: attendanceRecordsTable.classId,
      date: attendanceRecordsTable.attendanceDate,
      status: attendanceRecordsTable.status,
      note: attendanceRecordsTable.note,
      lastName: studentsTable.lastName,
    })
    .from(attendanceRecordsTable)
    .innerJoin(
      studentsTable,
      eq(attendanceRecordsTable.studentId, studentsTable.id),
    )
    .where(
      and(
        eq(attendanceRecordsTable.schoolId, schoolId),
        eq(attendanceRecordsTable.attendanceDate, date),
        classId ? eq(attendanceRecordsTable.classId, classId) : undefined,
      ),
    )
    .orderBy(asc(studentsTable.lastName), asc(studentsTable.firstName))
    .then((rows) =>
      rows.map((row) => ({
        id: row.id,
        studentId: row.studentId,
        studentName: `${row.firstName} ${row.lastName}`,
        admissionNumber: row.admissionNumber,
        classId: row.classId,
        date: row.date,
        status: row.status,
        note: row.note,
      })),
    );
}

router.get("/attendance", async (req, res): Promise<void> => {
  const query = ListAttendanceQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: "Choose a valid attendance date." });
    return;
  }
  const userId = res.locals.userId;
  if (!userId) {
    res.status(401).json({ error: "Sign in is required." });
    return;
  }
  const records = await withSchoolAccess(
    userId,
    SCHOOL_STAFF,
    (tx, membership) =>
      getRegister(
        tx,
        membership.schoolId,
        calendarDate(query.data.date),
        query.data.classId,
      ),
  );
  res.json(ListAttendanceResponse.parse(records));
});

router.post("/attendance", async (req, res): Promise<void> => {
  const parsed = SaveAttendanceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Check the attendance register and try again." });
    return;
  }
  const userId = res.locals.userId;
  if (!userId) {
    res.status(401).json({ error: "Sign in is required." });
    return;
  }

  const result = await withSchoolAccess(
    userId,
    SCHOOL_STAFF,
    async (tx, membership) => {
      const { classId, records } = parsed.data;
      const date = calendarDate(parsed.data.date);
      const uniqueStudentIds = [...new Set(records.map((record) => record.studentId))];
      if (uniqueStudentIds.length !== records.length) {
        throw new SchoolAccessError(
          "Each student can appear only once in a register.",
          400,
        );
      }

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

      const classStudents = await tx
        .select({ id: studentsTable.id })
        .from(studentsTable)
        .where(
          and(
            eq(studentsTable.schoolId, membership.schoolId),
            eq(studentsTable.classId, classId),
            eq(studentsTable.status, "active"),
            inArray(studentsTable.id, uniqueStudentIds),
          ),
        );
      if (classStudents.length !== records.length) {
        throw new SchoolAccessError(
          "The register includes a student outside this active class.",
          400,
        );
      }

      for (const record of records) {
        await tx
          .insert(attendanceRecordsTable)
          .values({
            schoolId: membership.schoolId,
            classId,
            studentId: record.studentId,
            attendanceDate: date,
            status: record.status,
            note: record.note ?? null,
            recordedBy: userId,
          })
          .onConflictDoUpdate({
          target: [
            attendanceRecordsTable.studentId,
            attendanceRecordsTable.attendanceDate,
          ],
          set: {
            classId,
            status: record.status,
            note: record.note ?? null,
            recordedBy: userId,
          },
        });
      }

      await writeAuditLog(
        tx,
        membership.schoolId,
        userId,
        "attendance.saved",
        "attendance_batch",
        null,
        { date, classId, recordCount: records.length },
      );
      return getRegister(tx, membership.schoolId, date, classId);
    },
  );
  res.json(SaveAttendanceResponse.parse(result));
});

export default router;
