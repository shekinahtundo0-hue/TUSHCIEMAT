import type { SchoolRole } from "@workspace/db/schema";

// API-level role gates. They mirror the database policies so callers get a
// clear 403 up front; RLS still enforces the same rules underneath.
export const MANAGERS = ["owner", "school_admin"] as const satisfies readonly SchoolRole[];
export const STAFF = [
  "owner",
  "school_admin",
  "principal",
  "academic_admin",
] as const satisfies readonly SchoolRole[];
export const GUARDIAN_VIEWERS = [...STAFF, "bursar"] as const satisfies readonly SchoolRole[];
// Guardians viewing their own linked children's records. Staff use the staff-facing endpoints instead.
export const GUARDIAN = ["parent"] as const satisfies readonly SchoolRole[];
export const STUDENT_VIEWERS = [...STAFF, "bursar", "teacher"] as const satisfies readonly SchoolRole[];
export const ATTENDANCE_TAKERS = [...STAFF, "teacher"] as const satisfies readonly SchoolRole[];
// Classroom content authorship: teachers are scoped to their classes by RLS (teaches_class).
export const CLASSROOM_MANAGERS = [...STAFF, "teacher"] as const satisfies readonly SchoolRole[];
export const ANY_MEMBER = [
  "owner",
  "school_admin",
  "principal",
  "academic_admin",
  "bursar",
  "teacher",
  "parent",
  "student",
  "tutor",
] as const satisfies readonly SchoolRole[];

export function hasAny(roles: readonly SchoolRole[], allowed: readonly SchoolRole[]): boolean {
  return roles.some((role) => allowed.includes(role));
}
