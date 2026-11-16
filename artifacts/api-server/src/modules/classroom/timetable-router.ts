import { Router } from "express";
import { and, eq, desc, inArray, sql } from "drizzle-orm";
import {
  classTimetablesTable,
  studentsTable,
  classesTable,
} from "@workspace/db/schema";
import { inSchool, send, currentUserId } from "../../lib/context";
import type { AppDeps } from "../../lib/deps";
import { parseInput, badRequest, notFound } from "../../lib/errors";
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

function getDayOfWeek(date: Date): number {
  // JavaScript: 0 = Sunday, 1 = Monday, ... 6 = Saturday
  // We want: 0 = Monday, 1 = Tuesday, ... 6 = Sunday
  const jsDay = date.getDay();
  return jsDay === 0 ? 6 : jsDay - 1;
}

function getTodayDate(): string {
  const now = new Date();
  return now.toISOString().split("T")[0];
}

function getWeekStartDate(date: Date = new Date()): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is Sunday
  const monday = new Date(d.setDate(diff));
  return monday.toISOString().split("T")[0];
}

// ============================================================================
// Route Handlers
// ============================================================================

export function timetableRouter(deps: AppDeps): Router {
  const router = Router();
  const { database, logger } = deps;

  /**
   * GET /api/v1/timetable/today
   * Returns today's schedule for current student's class
   */
  router.get("/today", async (req, res) => {
    await inSchool(database, req, res, ANY_MEMBER, async (tx, ctx) => {
      const userId = currentUserId(res);
      const studentId = await getStudentId(tx, database, userId, ctx.schoolId);

      if (!studentId) {
        throw badRequest("User is not a student in this school.", "not_a_student");
      }

      const classId = await getStudentClassId(tx, studentId, ctx.schoolId);
      if (!classId) {
        throw badRequest("Student is not enrolled in a class.", "no_class");
      }

      const today = new Date();
      const dayOfWeek = getDayOfWeek(today);
      const todayDate = getTodayDate();

      // Get today's timetable
      const timetable = await tx
        .select()
        .from(classTimetablesTable)
        .where(
          and(
            eq(classTimetablesTable.schoolId, ctx.schoolId),
            eq(classTimetablesTable.classId, classId),
            eq(classTimetablesTable.dayOfWeek, dayOfWeek),
          ),
        )
        .orderBy(classTimetablesTable.startTime);

      const result = timetable.map((entry) => ({
        id: entry.id,
        period: entry.periodNumber,
        subject: entry.subject,
        teacher: entry.teacherUserId,
        startTime: entry.startTime,
        endTime: entry.endTime,
        room: entry.roomLocation,
        date: todayDate,
      }));

      send(res, { data: result, date: todayDate });
    });
  });

  /**
   * GET /api/v1/timetable/week
   * Returns this week's full timetable for current student's class
   */
  router.get("/week", async (req, res) => {
    await inSchool(database, req, res, ANY_MEMBER, async (tx, ctx) => {
      const userId = currentUserId(res);
      const studentId = await getStudentId(tx, database, userId, ctx.schoolId);

      if (!studentId) {
        throw badRequest("User is not a student in this school.", "not_a_student");
      }

      const classId = await getStudentClassId(tx, studentId, ctx.schoolId);
      if (!classId) {
        throw badRequest("Student is not enrolled in a class.", "no_class");
      }

      // Get all timetable entries for this class (7 days)
      const timetable = await tx
        .select()
        .from(classTimetablesTable)
        .where(
          and(
            eq(classTimetablesTable.schoolId, ctx.schoolId),
            eq(classTimetablesTable.classId, classId),
          ),
        )
        .orderBy(
          classTimetablesTable.dayOfWeek,
          classTimetablesTable.startTime,
        );

      // Group by day
      const daysMap: Record<number, any[]> = {};
      const dayNames = [
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
        "Sunday",
      ];

      for (let i = 0; i < 7; i++) {
        daysMap[i] = [];
      }

      timetable.forEach((entry) => {
        daysMap[entry.dayOfWeek].push({
          id: entry.id,
          period: entry.periodNumber,
          subject: entry.subject,
          teacher: entry.teacherUserId,
          startTime: entry.startTime,
          endTime: entry.endTime,
          room: entry.roomLocation,
        });
      });

      const weekStart = getWeekStartDate();
      const result = Object.entries(daysMap).map(([dayIndex, classes]) => ({
        dayOfWeek: parseInt(dayIndex),
        dayName: dayNames[parseInt(dayIndex)],
        classes,
      }));

      send(res, { data: result, weekStart });
    });
  });

  /**
   * GET /api/v1/timetable?date=YYYY-MM-DD
   * Returns timetable for specified date
   */
  router.get("/", async (req, res) => {
    const query = parseInput(
      {
        date: { type: "string", required: false },
        classId: { type: "string", required: false },
      },
      req.query,
    );

    await inSchool(database, req, res, ANY_MEMBER, async (tx, ctx) => {
      const userId = currentUserId(res);

      // Determine which class's timetable to fetch
      let targetClassId = query.classId;

      if (!targetClassId) {
        const studentId = await getStudentId(tx, database, userId, ctx.schoolId);
        if (studentId) {
          targetClassId = await getStudentClassId(tx, studentId, ctx.schoolId);
        }
      }

      if (!targetClassId) {
        throw badRequest(
          "Cannot determine class. Provide classId or enroll as student.",
          "no_class",
        );
      }

      // Parse date
      const targetDate = query.date ? new Date(query.date) : new Date();
      if (isNaN(targetDate.getTime())) {
        throw badRequest("Invalid date format. Use YYYY-MM-DD.", "validation_failed");
      }

      const dayOfWeek = getDayOfWeek(targetDate);
      const dateStr = targetDate.toISOString().split("T")[0];

      // Get timetable for that day
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

      const result = timetable.map((entry) => ({
        id: entry.id,
        period: entry.periodNumber,
        subject: entry.subject,
        teacher: entry.teacherUserId,
        startTime: entry.startTime,
        endTime: entry.endTime,
        room: entry.roomLocation,
      }));

      send(res, { data: result, date: dateStr, dayOfWeek });
    });
  });

  /**
   * POST /api/v1/timetable
   * Creates/updates timetable entries (admin)
   */
  router.post("/", async (req, res) => {
    const {
      classId,
      dayOfWeek,
      periodNumber,
      startTime,
      endTime,
      subject,
      teacherUserId,
      roomLocation,
    } = parseInput(
      {
        classId: { type: "string", required: true },
        dayOfWeek: { type: "number", required: true },
        periodNumber: { type: "number", required: true },
        startTime: { type: "string", required: true },
        endTime: { type: "string", required: true },
        subject: { type: "string", required: true },
        teacherUserId: { type: "string", required: true },
        roomLocation: { type: "string", required: false },
      },
      req.body,
    );

    // Validate inputs
    if (dayOfWeek < 0 || dayOfWeek > 6) {
      throw badRequest("Day of week must be 0-6 (Monday-Sunday).", "validation_failed");
    }
    if (periodNumber < 1) {
      throw badRequest("Period number must be >= 1.", "validation_failed");
    }
    if (startTime >= endTime) {
      throw badRequest("Start time must be before end time.", "validation_failed");
    }

    await inSchool(
      database,
      req,
      res,
      { roles: STAFF, capability: "classroom.manage" },
      async (tx, ctx) => {
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

        // Check if timetable entry already exists
        const [existing] = await tx
          .select()
          .from(classTimetablesTable)
          .where(
            and(
              eq(classTimetablesTable.classId, classId),
              eq(classTimetablesTable.dayOfWeek, dayOfWeek),
              eq(classTimetablesTable.periodNumber, periodNumber),
            ),
          );

        if (existing) {
          // Update existing entry
          await tx
            .update(classTimetablesTable)
            .set({
              subject,
              teacherUserId,
              startTime,
              endTime,
              roomLocation: roomLocation || null,
            })
            .where(eq(classTimetablesTable.id, existing.id));

          send(res, {
            id: existing.id,
            classId,
            dayOfWeek,
            periodNumber,
            subject,
            startTime,
            endTime,
          });
        } else {
          // Create new entry
          const [created] = await tx
            .insert(classTimetablesTable)
            .values({
              schoolId: ctx.schoolId,
              classId,
              dayOfWeek,
              periodNumber,
              startTime,
              endTime,
              subject,
              teacherUserId,
              roomLocation: roomLocation || null,
            })
            .returning();

          send(
            res,
            {
              id: created.id,
              classId,
              dayOfWeek,
              periodNumber,
              subject,
              startTime,
              endTime,
            },
            201,
          );
        }
      },
    );
  });

  return router;
}

export default timetableRouter;
