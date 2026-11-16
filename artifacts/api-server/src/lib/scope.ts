import { inArray, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { classTeacherAssignmentsTable, type SchoolRole } from "@workspace/db/schema";
import type { SchoolContext } from "./context";
import { hasAny } from "./roles";

/**
 * Restricts `classColumn` to the caller's assigned classes unless they hold
 * one of `fullAccess`. Mirrors the teaches_class() RLS rule in the API layer.
 */
export function assignedClassesOnly(
  ctx: SchoolContext,
  classColumn: AnyColumn,
  fullAccess: readonly SchoolRole[],
): SQL | undefined {
  if (hasAny(ctx.roles, fullAccess)) return undefined;
  return inArray(
    classColumn,
    sql`(select ${classTeacherAssignmentsTable.classId} from ${classTeacherAssignmentsTable}
      where ${classTeacherAssignmentsTable.schoolId} = ${ctx.schoolId}
        and ${classTeacherAssignmentsTable.teacherUserId} = ${ctx.userId})`,
  );
}
