import { randomBytes } from "node:crypto";
import { and, count, countDistinct, eq, sql } from "drizzle-orm";
import type { SchoolInput, SchoolSettingsInput } from "@workspace/api-zod";
import {
  academicYearsTable,
  attendanceRecordsTable,
  classesTable,
  schoolMembershipsTable,
  schoolsTable,
  studentsTable,
  termsTable,
} from "@workspace/db/schema";
import type { Database, Tx } from "../../lib/database";
import { audit, schoolCapabilities, type SchoolContext } from "../../lib/context";
import { todayIn } from "../../lib/dates";
import { badRequest, notFound } from "../../lib/errors";
import { assertDateRange } from "../academics/service";

function webUrl(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw badRequest("Enter a complete HTTP or HTTPS address.", "validation_failed"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw badRequest("Use an HTTP or HTTPS address without embedded credentials.", "validation_failed");
  }
  return url.href;
}

function schoolDetails(input: SchoolInput | SchoolSettingsInput) {
  const name = input.name.trim().replace(/\s+/g, " ");
  const curriculum = input.curriculum.trim();
  const country = input.country?.trim() ?? "Kenya";
  if (name.length < 2 || curriculum.length < 2 || country.length < 2) {
    throw badRequest("Enter the school name, curriculum and country.", "validation_failed");
  }
  return {
    name, category: input.category, curriculum, country,
    county: input.county?.trim() || null,
    town: input.town?.trim() || null,
    logoUrl: webUrl(input.logoUrl),
    description: input.description?.trim() || null,
    contactEmail: input.contactEmail?.trim().toLowerCase() || null,
    contactPhone: input.contactPhone?.trim() || null,
    website: webUrl(input.website),
    discoverable: input.discoverable ?? false,
  };
}

function slugFor(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${base || "school"}-${randomBytes(3).toString("hex")}`;
}

export function createSchool(database: Database, userId: string, input: SchoolInput) {
  assertDateRange(input.academicYear.startsOn, input.academicYear.endsOn);

  return database.asUser(userId, async (tx) => {
    const [school] = await tx
      .insert(schoolsTable)
      .values({
        ...schoolDetails(input),
        slug: slugFor(input.name),
        createdByUserId: userId,
      })
      .returning();

    // The creator becomes the first owner; the database only allows this
    // self-grant while the school has no members at all.
    await tx.insert(schoolMembershipsTable).values({
      schoolId: school.id,
      authUserId: userId,
      role: "owner",
    });

    const [year] = await tx
      .insert(academicYearsTable)
      .values({
        schoolId: school.id,
        name: input.academicYear.name.trim(),
        startsOn: input.academicYear.startsOn,
        endsOn: input.academicYear.endsOn,
        isCurrent: true,
      })
      .returning({ id: academicYearsTable.id });

    const ctx: SchoolContext = {
      userId,
      schoolId: school.id,
      roles: ["owner"],
      capabilities: await schoolCapabilities(tx, school.id),
    };
    await audit(tx, ctx, "school.created", "school", school.id, { academicYearId: year.id });
    return school;
  });
}

export async function getSchoolSettings(tx: Tx, ctx: SchoolContext) {
  const [school] = await tx.select().from(schoolsTable).where(eq(schoolsTable.id, ctx.schoolId));
  if (!school) throw notFound("School not found.");
  return school;
}

export async function updateSchoolSettings(tx: Tx, ctx: SchoolContext, input: SchoolSettingsInput) {
  const [school] = await tx.update(schoolsTable).set(schoolDetails(input))
    .where(eq(schoolsTable.id, ctx.schoolId)).returning();
  if (!school) throw notFound("School not found.");
  await audit(tx, ctx, "school.settings_updated", "school", ctx.schoolId, { discoverable: school.discoverable });
  return school;
}

async function countOf(query: Promise<Array<{ value: number }>>): Promise<number> {
  const [row] = await query;
  return Number(row?.value ?? 0);
}

export async function getDashboard(tx: Tx, ctx: SchoolContext, timezone: string) {
  const [school] = await tx.select().from(schoolsTable).where(eq(schoolsTable.id, ctx.schoolId));
  if (!school) throw notFound("School not found.");

  const [currentYear] = await tx
    .select({ id: academicYearsTable.id, name: academicYearsTable.name })
    .from(academicYearsTable)
    .where(and(eq(academicYearsTable.schoolId, ctx.schoolId), eq(academicYearsTable.isCurrent, true)));
  const [currentTerm] = await tx
    .select({ name: termsTable.name })
    .from(termsTable)
    .where(and(eq(termsTable.schoolId, ctx.schoolId), eq(termsTable.isCurrent, true)));

  const today = todayIn(timezone);

  const totalStudents = await countOf(
    tx
      .select({ value: count() })
      .from(studentsTable)
      .where(and(eq(studentsTable.schoolId, ctx.schoolId), eq(studentsTable.status, "active"))),
  );
  const totalClasses = await countOf(
    tx
      .select({ value: count() })
      .from(classesTable)
      .where(
        and(
          eq(classesTable.schoolId, ctx.schoolId),
          currentYear ? eq(classesTable.academicYearId, currentYear.id) : undefined,
        ),
      ),
  );
  const totalTeachers = await countOf(
    tx
      .select({ value: countDistinct(schoolMembershipsTable.authUserId) })
      .from(schoolMembershipsTable)
      .where(
        and(
          eq(schoolMembershipsTable.schoolId, ctx.schoolId),
          eq(schoolMembershipsTable.role, "teacher"),
          eq(schoolMembershipsTable.status, "active"),
        ),
      ),
  );

  const [marks] = await tx
    .select({
      marked: count(),
      present: sql<number>`count(*) filter (where ${attendanceRecordsTable.status} in ('present', 'late'))`,
      absent: sql<number>`count(*) filter (where ${attendanceRecordsTable.status} = 'absent')`,
    })
    .from(attendanceRecordsTable)
    .where(
      and(
        eq(attendanceRecordsTable.schoolId, ctx.schoolId),
        eq(attendanceRecordsTable.attendanceDate, today),
      ),
    );

  const markedToday = Number(marks?.marked ?? 0);
  const presentToday = Number(marks?.present ?? 0);

  return {
    school,
    currentYear: currentYear?.name ?? null,
    currentTerm: currentTerm?.name ?? null,
    totalStudents,
    totalClasses,
    totalTeachers,
    markedToday,
    presentToday,
    absentToday: Number(marks?.absent ?? 0),
    attendanceRate: markedToday === 0 ? null : Math.round((presentToday / markedToday) * 1000) / 10,
  };
}
