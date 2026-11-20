import { Router } from "express";
import { and, eq } from "drizzle-orm";
import {
  classTimetablesTable,
  studentsTable,
  classesTable,
} from "@workspace/db/schema";
import {
  GetTodayTimetableResponse,
  GetTimetableForWeekResponse,
  GetTimetableForDateQueryParams,
  GetTimetableForDateResponse,
  UpsertTimetableEntryBody,
  UpsertTimetableEntryResponse,
} from "@workspace/api-zod";
import { inSchool, send, currentUserId } from "../../lib/context";
import type { Tx } from "../../lib/database";
import type { AppDeps } from "../../lib/deps";
import { parseInput, badRequest, notFound } from "../../lib/errors";
import { ANY_MEMBER, CLASSROOM_MANAGERS } from "../../lib/roles";

async function getStudentClassId(tx: Tx, userId: string, schoolId: string): Promise<string | null> {
  const [student] = await tx
    .select({ classId: studentsTable.classId })
    .from(studentsTable)
    .where(
      and(
        eq(studentsTable.schoolId, schoolId),
        eq(studentsTable.authUserId, userId),
      ),
    );
  return student?.classId ?? null;
}

// Timetable days are Monday-first: 0 = Monday ... 6 = Sunday.
function getDayOfWeek(date: Date): number {
  const jsDay = date.getDay();
  return jsDay === 0 ? 6 : jsDay - 1;
}

function toCalendarDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

function getWeekStartDate(date: Date = new Date()): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setDate(diff));
  return toCalendarDate(monday);
}

const DAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

export function timetableRouter(deps: AppDeps): Router {
  const router = Router();
  const { database } = deps;

  router.get("/today", async (req, res) => {
    await inSchool(database, req, res, ANY_MEMBER, async (tx, ctx) => {
      const classId = await getStudentClassId(tx, currentUserId(res), ctx.schoolId);
      if (!classId) {
        throw badRequest("Student is not enrolled in a class.", "no_class");
      }

      const today = new Date();
      const todayDate = toCalendarDate(today);

      const timetable = await tx
        .select()
        .from(classTimetablesTable)
        .where(
          and(
            eq(classTimetablesTable.schoolId, ctx.schoolId),
            eq(classTimetablesTable.classId, classId),
            eq(classTimetablesTable.dayOfWeek, getDayOfWeek(today)),
          ),
        )
        .orderBy(classTimetablesTable.startTime);

      send(res, GetTodayTimetableResponse, {
        data: timetable.map((entry) => ({
          id: entry.id,
          period: entry.periodNumber,
          subject: entry.subject,
          teacher: entry.teacherUserId,
          startTime: entry.startTime,
          endTime: entry.endTime,
          room: entry.roomLocation,
        })),
        date: todayDate,
      });
    });
  });

  router.get("/week", async (req, res) => {
    await inSchool(database, req, res, ANY_MEMBER, async (tx, ctx) => {
      const classId = await getStudentClassId(tx, currentUserId(res), ctx.schoolId);
      if (!classId) {
        throw badRequest("Student is not enrolled in a class.", "no_class");
      }

      const timetable = await tx
        .select()
        .from(classTimetablesTable)
        .where(
          and(
            eq(classTimetablesTable.schoolId, ctx.schoolId),
            eq(classTimetablesTable.classId, classId),
          ),
        )
        .orderBy(classTimetablesTable.dayOfWeek, classTimetablesTable.startTime);

      const days = DAY_NAMES.map((dayName, dayOfWeek) => ({
        dayOfWeek,
        dayName,
        classes: timetable
          .filter((entry) => entry.dayOfWeek === dayOfWeek)
          .map((entry) => ({
            id: entry.id,
            period: entry.periodNumber,
            subject: entry.subject,
            teacher: entry.teacherUserId,
            startTime: entry.startTime,
            endTime: entry.endTime,
            room: entry.roomLocation,
          })),
      }));

      send(res, GetTimetableForWeekResponse, { data: days, weekStart: getWeekStartDate() });
    });
  });

  router.get("/", async (req, res) => {
    const query = parseInput(GetTimetableForDateQueryParams, req.query);

    await inSchool(database, req, res, ANY_MEMBER, async (tx, ctx) => {
      const targetClassId =
        query.classId ?? (await getStudentClassId(tx, currentUserId(res), ctx.schoolId));
      if (!targetClassId) {
        throw badRequest(
          "Cannot determine class. Provide classId or enroll as student.",
          "no_class",
        );
      }

      const targetDate = query.date ? new Date(query.date) : new Date();
      const dayOfWeek = getDayOfWeek(targetDate);

      const timetable = await tx
        .select()
        .from(classTimetablesTable)
        .where(
          and(
            eq(classTimetablesTable.schoolId, ctx.schoolId),
            eq(classTimetablesTable.classId, targetClassId),
            eq(classTimetablesTable.dayOfWeek, dayOfWeek),
          ),
        )
        .orderBy(classTimetablesTable.startTime);

      send(res, GetTimetableForDateResponse, {
        data: timetable.map((entry) => ({
          id: entry.id,
          period: entry.periodNumber,
          subject: entry.subject,
          teacher: entry.teacherUserId,
          startTime: entry.startTime,
          endTime: entry.endTime,
          room: entry.roomLocation,
        })),
        date: toCalendarDate(targetDate),
        dayOfWeek,
      });
    });
  });

  router.post("/", async (req, res) => {
    const input = parseInput(UpsertTimetableEntryBody, req.body);
    if (input.startTime >= input.endTime) {
      throw badRequest("Start time must be before end time.", "validation_failed");
    }

    await inSchool(
      database,
      req,
      res,
      { roles: CLASSROOM_MANAGERS, capability: "classroom.manage", scopedRoles: ["teacher"] },
      async (tx, ctx) => {
        const [cls] = await tx
          .select({ id: classesTable.id })
          .from(classesTable)
          .where(
            and(eq(classesTable.id, input.classId), eq(classesTable.schoolId, ctx.schoolId)),
          );
        if (!cls) throw notFound("Class not found.");

        const [existing] = await tx
          .select({ id: classTimetablesTable.id })
          .from(classTimetablesTable)
          .where(
            and(
              eq(classTimetablesTable.schoolId, ctx.schoolId),
              eq(classTimetablesTable.classId, input.classId),
              eq(classTimetablesTable.dayOfWeek, input.dayOfWeek),
              eq(classTimetablesTable.periodNumber, input.periodNumber),
            ),
          );

        const values = {
          subject: input.subject,
          teacherUserId: input.teacherUserId,
          startTime: input.startTime,
          endTime: input.endTime,
          roomLocation: input.roomLocation ?? null,
        };
        const saved = existing
          ? (
              await tx
                .update(classTimetablesTable)
                .set(values)
                .where(eq(classTimetablesTable.id, existing.id))
                .returning()
            )[0]
          : (
              await tx
                .insert(classTimetablesTable)
                .values({ schoolId: ctx.schoolId, classId: input.classId, dayOfWeek: input.dayOfWeek, periodNumber: input.periodNumber, ...values })
                .returning()
            )[0];

        send(
          res,
          UpsertTimetableEntryResponse,
          {
            id: saved.id,
            classId: saved.classId,
            dayOfWeek: saved.dayOfWeek,
            periodNumber: saved.periodNumber,
            subject: saved.subject,
            startTime: saved.startTime,
            endTime: saved.endTime,
          },
          existing ? 200 : 201,
        );
      },
    );
  });

  return router;
}

export default timetableRouter;