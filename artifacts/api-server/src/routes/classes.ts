import { and, asc, count, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateClassBody,
  CreateClassResponse,
  ListClassesResponse,
} from "@workspace/api-zod";
import { classesTable, studentsTable } from "@workspace/db";
import { withSchoolAccess, writeAuditLog } from "../lib/schoolAccess";

const router: IRouter = Router();
const SCHOOL_STAFF = [
  "owner",
  "school_admin",
  "principal",
  "academic_admin",
] as const;

router.get("/classes", async (_req, res): Promise<void> => {
  const userId = res.locals.userId;
  if (!userId) {
    res.status(401).json({ error: "Sign in is required." });
    return;
  }
  const classes = await withSchoolAccess(
    userId,
    SCHOOL_STAFF,
    async (tx, membership) =>
      tx
        .select({
          id: classesTable.id,
          name: classesTable.name,
          grade: classesTable.grade,
          stream: classesTable.stream,
          academicYear: classesTable.academicYear,
          studentCount: count(studentsTable.id),
        })
        .from(classesTable)
        .leftJoin(
          studentsTable,
          and(
            eq(studentsTable.classId, classesTable.id),
            eq(studentsTable.status, "active"),
          ),
        )
        .where(eq(classesTable.schoolId, membership.schoolId))
        .groupBy(
          classesTable.id,
          classesTable.name,
          classesTable.grade,
          classesTable.stream,
          classesTable.academicYear,
          classesTable.createdAt,
        )
        .orderBy(asc(classesTable.grade), asc(classesTable.name)),
  );
  res.json(ListClassesResponse.parse(classes));
});

router.post("/classes", async (req, res): Promise<void> => {
  const parsed = CreateClassBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Check the class details and try again." });
    return;
  }
  const userId = res.locals.userId;
  if (!userId) {
    res.status(401).json({ error: "Sign in is required." });
    return;
  }

  const createdClass = await withSchoolAccess(
    userId,
    SCHOOL_STAFF,
    async (tx, membership) => {
      const [schoolClass] = await tx
        .insert(classesTable)
        .values({
          schoolId: membership.schoolId,
          name: parsed.data.name.trim(),
          grade: parsed.data.grade.trim(),
          stream: parsed.data.stream?.trim() || null,
          academicYear: parsed.data.academicYear.trim(),
        })
        .returning();

      await writeAuditLog(
        tx,
        membership.schoolId,
        userId,
        "class.created",
        "class",
        schoolClass.id,
      );
      return {
        id: schoolClass.id,
        name: schoolClass.name,
        grade: schoolClass.grade,
        stream: schoolClass.stream,
        academicYear: schoolClass.academicYear,
        studentCount: 0,
      };
    },
  );
  res.status(201).json(CreateClassResponse.parse(createdClass));
});

export default router;
