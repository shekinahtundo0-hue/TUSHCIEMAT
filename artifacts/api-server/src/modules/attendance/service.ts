import { and, asc, eq, sql } from "drizzle-orm";
import { attendanceRecordsTable, classesTable, studentsTable } from "@workspace/db/schema";
import type { Tx } from "../../lib/database";
import { audit, type SchoolContext } from "../../lib/context";
import { isCalendarDate, todayIn } from "../../lib/dates";
import { badRequest, notFound } from "../../lib/errors";
import { STAFF } from "../../lib/roles";
import { assignedClassesOnly } from "../../lib/scope";

type AttendanceStatus = "present" | "absent" | "late" | "excused";

async function assertClassVisible(tx: Tx, ctx: SchoolContext, classId: string): Promise<void> {
  const [found] = await tx
    .select({ id: classesTable.id })
    .from(classesTable)
    .where(
      and(
        eq(classesTable.id, classId),
        eq(classesTable.schoolId, ctx.schoolId),
        assignedClassesOnly(ctx, classesTable.id, STAFF),
      ),
    );
  if (!found) throw notFound("Class not found.");
}

function assertDate(date: string): void {
  if (!isCalendarDate(date)) throw badRequest("date must be a real calendar date (YYYY-MM-DD).", "validation_failed");
}

export async function getRegister(tx: Tx, ctx: SchoolContext, classId: string, date: string) {
  assertDate(date);
  await assertClassVisible(tx, ctx, classId);

  const rows = await tx
    .select({
      studentId: studentsTable.id,
      firstName: studentsTable.firstName,
      lastName: studentsTable.lastName,
      admissionNumber: studentsTable.admissionNumber,
      status: attendanceRecordsTable.status,
      note: attendanceRecordsTable.note,
    })
    .from(studentsTable)
    .leftJoin(
      attendanceRecordsTable,
      and(
        eq(attendanceRecordsTable.studentId, studentsTable.id),
        eq(attendanceRecordsTable.schoolId, ctx.schoolId),
        eq(attendanceRecordsTable.attendanceDate, date),
      ),
    )
    .where(
      and(
        eq(studentsTable.schoolId, ctx.schoolId),
        eq(studentsTable.classId, classId),
        eq(studentsTable.status, "active"),
      ),
    )
    .orderBy(asc(studentsTable.lastName), asc(studentsTable.firstName));

  return {
    classId,
    date,
    entries: rows.map((row) => ({
      studentId: row.studentId,
      studentName: `${row.firstName} ${row.lastName}`,
      admissionNumber: row.admissionNumber,
      status: row.status,
      note: row.note,
    })),
  };
}

export async function saveAttendance(
  tx: Tx,
  ctx: SchoolContext,
  input: {
    classId: string;
    date: string;
    records: Array<{ studentId: string; status: AttendanceStatus; note?: string | null }>;
  },
  timezone: string,
) {
  assertDate(input.date);
  if (input.date > todayIn(timezone)) {
    throw badRequest("Attendance cannot be recorded for a future date.", "validation_failed");
  }
  await assertClassVisible(tx, ctx, input.classId);

  const roster = await tx
    .select({ id: studentsTable.id })
    .from(studentsTable)
    .where(
      and(
        eq(studentsTable.schoolId, ctx.schoolId),
        eq(studentsTable.classId, input.classId),
        eq(studentsTable.status, "active"),
      ),
    );
  const enrolled = new Set(roster.map((student) => student.id));
  const seen = new Set<string>();
  for (const record of input.records) {
    if (seen.has(record.studentId)) throw badRequest("Each student can be marked only once.", "validation_failed");
    seen.add(record.studentId);
    if (!enrolled.has(record.studentId)) {
      throw badRequest("Every student must be active in this class.", "validation_failed");
    }
  }

  await tx
    .insert(attendanceRecordsTable)
    .values(
      input.records.map((record) => ({
        schoolId: ctx.schoolId,
        classId: input.classId,
        studentId: record.studentId,
        attendanceDate: input.date,
        status: record.status,
        note: record.note?.trim() || null,
        recordedBy: ctx.userId,
      })),
    )
    .onConflictDoUpdate({
      target: [attendanceRecordsTable.studentId, attendanceRecordsTable.attendanceDate],
      set: {
        classId: sql`excluded.class_id`,
        status: sql`excluded.status`,
        note: sql`excluded.note`,
        recordedBy: sql`excluded.recorded_by`,
      },
    });

  await audit(tx, ctx, "attendance.saved", "class", input.classId, {
    date: input.date,
    records: input.records.length,
  });
  return getRegister(tx, ctx, input.classId, input.date);
}
