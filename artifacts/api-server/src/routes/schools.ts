import { randomUUID } from "node:crypto";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateSchoolBody,
  CreateSchoolResponse,
  GetDashboardResponse,
  GetSchoolContextResponse,
} from "@workspace/api-zod";
import {
  db,
  attendanceRecordsTable,
  classesTable,
  schoolMembershipsTable,
  schoolsTable,
  studentsTable,
} from "@workspace/db";
import {
  setUserContext,
  withSchoolAccess,
  writeAuditLog,
} from "../lib/schoolAccess";

const router: IRouter = Router();

const SCHOOL_ADMIN_ROLES = [
  "owner",
  "school_admin",
  "principal",
  "academic_admin",
] as const;

function makeSlug(name: string): string {
  const base = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return `${base || "school"}-${randomUUID().slice(0, 8)}`;
}

router.post("/schools", async (req, res): Promise<void> => {
  const parsed = CreateSchoolBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Check the school details and try again." });
    return;
  }

  const userId = res.locals.userId;
  if (!userId) {
    res.status(401).json({ error: "Sign in is required." });
    return;
  }

  const name = parsed.data.name.trim();
  const curriculum = parsed.data.curriculum.trim();
  if (!name || !curriculum) {
    res.status(400).json({ error: "School name and curriculum are required." });
    return;
  }

  const school = await db.transaction(async (tx) => {
    await setUserContext(tx, userId);
    await tx.execute(
      // This transaction-local flag only authorizes the first owner grant
      // during this server-controlled school-creation flow.
      sql`select set_config('app.school_creation', 'true', true)`,
    );
    const schoolId = randomUUID();
    await tx.insert(schoolsTable).values({
      id: schoolId,
      name,
      slug: makeSlug(name),
      category: parsed.data.category,
      curriculum,
      county: parsed.data.county?.trim() || null,
    });

    await tx.insert(schoolMembershipsTable).values({
      schoolId,
      clerkUserId: userId,
      role: "owner",
      status: "active",
    });
    await tx.execute(
      sql`select set_config('app.current_school_id', ${schoolId}, true)`,
    );
    await tx.execute(
      sql`select set_config('app.school_member_admin', 'true', true)`,
    );
    const [createdSchool] = await tx
      .select()
      .from(schoolsTable)
      .where(eq(schoolsTable.id, schoolId))
      .limit(1);
    await writeAuditLog(
      tx,
      schoolId,
      userId,
      "school.created",
      "school",
      schoolId,
    );
    return createdSchool;
  });

  res.status(201).json(CreateSchoolResponse.parse(school));
});

router.get("/schools/me", async (_req, res): Promise<void> => {
  const userId = res.locals.userId;
  if (!userId) {
    res.status(401).json({ error: "Sign in is required." });
    return;
  }

  const memberships = await db.transaction(async (tx) => {
    await setUserContext(tx, userId);
    return tx
      .select({
        id: schoolMembershipsTable.id,
        schoolId: schoolsTable.id,
        schoolName: schoolsTable.name,
        role: schoolMembershipsTable.role,
        status: schoolMembershipsTable.status,
        createdAt: schoolMembershipsTable.createdAt,
      })
      .from(schoolMembershipsTable)
      .innerJoin(
        schoolsTable,
        eq(schoolMembershipsTable.schoolId, schoolsTable.id),
      )
      .where(
        and(
          eq(schoolMembershipsTable.clerkUserId, userId),
          eq(schoolMembershipsTable.status, "active"),
        ),
      )
      .orderBy(desc(schoolMembershipsTable.createdAt));
  });

  res.json(
    GetSchoolContextResponse.parse({
      userId,
      fullName: null,
      email: null,
      memberships: memberships.map((membership) => ({
        id: membership.id,
        schoolId: membership.schoolId,
        schoolName: membership.schoolName,
        role: membership.role,
        status: membership.status,
      })),
    }),
  );
});

router.get("/dashboard", async (_req, res): Promise<void> => {
  const userId = res.locals.userId;
  if (!userId) {
    res.status(401).json({ error: "Sign in is required." });
    return;
  }

  const result = await withSchoolAccess(
    userId,
    SCHOOL_ADMIN_ROLES,
    async (tx, membership) => {
      const [school] = await tx
        .select()
        .from(schoolsTable)
        .where(eq(schoolsTable.id, membership.schoolId))
        .limit(1);

      const [{ total: totalStudents }] = await tx
        .select({ total: count() })
        .from(studentsTable)
        .where(eq(studentsTable.status, "active"));
      const [{ total: totalClasses }] = await tx
        .select({ total: count() })
        .from(classesTable);
      const [{ total: totalTeachers }] = await tx
        .select({ total: count() })
        .from(schoolMembershipsTable)
        .where(
          and(
            eq(schoolMembershipsTable.schoolId, membership.schoolId),
            eq(schoolMembershipsTable.role, "teacher"),
            eq(schoolMembershipsTable.status, "active"),
          ),
        );

      const dateParts = new Intl.DateTimeFormat("en", {
        timeZone: "Africa/Nairobi",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(new Date());
      const dateValues = Object.fromEntries(
        dateParts.map((part) => [part.type, part.value]),
      );
      const today = `${dateValues.year}-${dateValues.month}-${dateValues.day}`;
      const [attendanceStats] = await tx
        .select({
          total: count(),
          present: sql<number>`count(*) filter (where ${attendanceRecordsTable.status} in ('present', 'late'))`.mapWith(
            Number,
          ),
          absent: sql<number>`count(*) filter (where ${attendanceRecordsTable.status} = 'absent')`.mapWith(
            Number,
          ),
        })
        .from(attendanceRecordsTable)
        .where(eq(attendanceRecordsTable.attendanceDate, today));
      const attendanceCount = attendanceStats.total;
      const presentCount = attendanceStats.present;

      return {
        school,
        totalStudents: Number(totalStudents),
        totalClasses: Number(totalClasses),
        totalTeachers: Number(totalTeachers),
        presentToday: presentCount,
        absentToday: attendanceStats.absent,
        attendanceRate:
          attendanceCount === 0
            ? 0
            : Math.round((presentCount / attendanceCount) * 10000) / 100,
      };
    },
  );

  res.json(
    GetDashboardResponse.parse(result),
  );
});

export default router;
