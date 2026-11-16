import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";
import {
  attendanceRecordsTable,
  classesTable,
  guardiansTable,
  studentGuardiansTable,
  studentsTable,
} from "@workspace/db/schema";
import type { Tx } from "../../lib/database";
import type { SchoolContext } from "../../lib/context";
import { addDays, todayIn } from "../../lib/dates";
import { notFound } from "../../lib/errors";

const SUMMARY_DAYS = 30;
const RECENT_LIMIT = 10;

const learnerColumns = {
  studentId: studentsTable.id,
  firstName: studentsTable.firstName,
  lastName: studentsTable.lastName,
  admissionNumber: studentsTable.admissionNumber,
  className: classesTable.name,
  status: studentsTable.status,
};

type Learner = {
  studentId: string;
  firstName: string;
  lastName: string;
  admissionNumber: string;
  className: string | null;
  status: string;
};

async function withAttendance(tx: Tx, ctx: SchoolContext, learners: Learner[], timezone: string) {
  if (learners.length === 0) return [];
  const sinceDate = addDays(todayIn(timezone), -(SUMMARY_DAYS - 1));
  const ids = learners.map((learner) => learner.studentId);
  const records = await tx
    .select({
      studentId: attendanceRecordsTable.studentId,
      date: attendanceRecordsTable.attendanceDate,
      status: attendanceRecordsTable.status,
    })
    .from(attendanceRecordsTable)
    .where(
      and(
        eq(attendanceRecordsTable.schoolId, ctx.schoolId),
        inArray(attendanceRecordsTable.studentId, ids),
        gte(attendanceRecordsTable.attendanceDate, sinceDate),
      ),
    )
    .orderBy(desc(attendanceRecordsTable.attendanceDate));

  return learners.map((learner) => {
    const own = records.filter((record) => record.studentId === learner.studentId);
    const count = (status: string) => own.filter((record) => record.status === status).length;
    return {
      ...learner,
      attendance: {
        sinceDate,
        present: count("present"),
        absent: count("absent"),
        late: count("late"),
        excused: count("excused"),
        recent: own.slice(0, RECENT_LIMIT).map((record) => ({ date: record.date, status: record.status })),
      },
    };
  });
}

export async function listMyChildren(tx: Tx, ctx: SchoolContext, timezone: string) {
  const children = await tx
    .selectDistinct(learnerColumns)
    .from(guardiansTable)
    .innerJoin(
      studentGuardiansTable,
      and(eq(studentGuardiansTable.guardianId, guardiansTable.id), eq(studentGuardiansTable.schoolId, ctx.schoolId)),
    )
    .innerJoin(
      studentsTable,
      and(eq(studentsTable.id, studentGuardiansTable.studentId), eq(studentsTable.schoolId, ctx.schoolId)),
    )
    .leftJoin(classesTable, and(eq(classesTable.id, studentsTable.classId), eq(classesTable.schoolId, ctx.schoolId)))
    .where(and(eq(guardiansTable.schoolId, ctx.schoolId), eq(guardiansTable.authUserId, ctx.userId)))
    .orderBy(asc(studentsTable.firstName), asc(studentsTable.lastName));
  return withAttendance(tx, ctx, children, timezone);
}

export async function getMyLearnerRecord(tx: Tx, ctx: SchoolContext, timezone: string) {
  const [learner] = await tx
    .select(learnerColumns)
    .from(studentsTable)
    .leftJoin(classesTable, and(eq(classesTable.id, studentsTable.classId), eq(classesTable.schoolId, ctx.schoolId)))
    .where(and(eq(studentsTable.schoolId, ctx.schoolId), eq(studentsTable.authUserId, ctx.userId)));
  if (!learner) throw notFound("No learner record is linked to this account.");
  const [summary] = await withAttendance(tx, ctx, [learner], timezone);
  return summary;
}
