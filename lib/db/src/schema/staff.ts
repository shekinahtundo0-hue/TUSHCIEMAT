import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  decimal,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { classesTable } from "./academics";
import { userProfilesTable } from "./identity";
import { schoolsTable } from "./schools";

export const employmentTypeEnum = pgEnum("employment_type", [
  "full_time",
  "part_time",
  "contract",
  "casual",
]);

export const employmentStatusEnum = pgEnum("employment_status", [
  "active",
  "on_leave",
  "on_sabbatical",
  "resigned",
  "retired",
  "suspended",
]);

export const leaveTypeEnum = pgEnum("leave_type", [
  "sick",
  "annual",
  "unpaid",
  "sabbatical",
  "study",
  "maternity",
  "paternity",
  "bereavement",
]);

export const leaveRequestStatusEnum = pgEnum("leave_request_status", [
  "pending",
  "approved",
  "rejected",
  "cancelled",
]);

export const dayOfWeekEnum = pgEnum("day_of_week", [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
]);

export const staffEmploymentRecordsTable = pgTable(
  "staff_employment_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schoolsTable.id, { onDelete: "cascade" }),
    userAuthId: text("user_auth_id")
      .notNull()
      .references(() => userProfilesTable.authUserId),
    staffNumber: text("staff_number"),
    department: text("department"),
    designation: text("designation").notNull(),
    employmentType: employmentTypeEnum("employment_type").notNull(),
    hireDate: date("hire_date", { mode: "string" }).notNull(),
    employmentEndDate: date("employment_end_date", { mode: "string" }),
    employmentStatus: employmentStatusEnum("employment_status")
      .notNull()
      .default("active"),
    qualifications: jsonb("qualifications")
      .$type<string[]>()
      .default([]),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("staff_employment_records_school_user_unique").on(
      table.schoolId,
      table.userAuthId,
    ),
    uniqueIndex("staff_employment_records_school_staff_number_unique").on(
      table.schoolId,
      table.staffNumber,
    ),
    index("staff_employment_records_school_idx").on(table.schoolId),
    index("staff_employment_records_status_idx").on(table.employmentStatus),
    check(
      "staff_employment_records_dates_check",
      sql`${table.employmentEndDate} IS NULL OR ${table.employmentEndDate} >= ${table.hireDate}`,
    ),
  ],
);

export const teacherWorkloadTable = pgTable(
  "teacher_workload",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schoolsTable.id, { onDelete: "cascade" }),
    teacherAuthId: text("teacher_auth_id")
      .notNull()
      .references(() => userProfilesTable.authUserId),
    termId: uuid("term_id"),
    assignedPeriodsCount: integer("assigned_periods_count").notNull().default(0),
    maxAllowedPeriods: integer("max_allowed_periods"),
    isOverloaded: boolean("is_overloaded").notNull().default(false),
    workloadPercentage: decimal("workload_percentage", { precision: 5, scale: 2 })
      .notNull()
      .default("0"),
    calculatedAt: timestamp("calculated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("teacher_workload_identity_unique").on(
      table.schoolId,
      table.teacherAuthId,
      table.termId,
    ),
    index("teacher_workload_school_idx").on(table.schoolId),
    index("teacher_workload_overloaded_idx")
      .on(table.schoolId)
      .where(sql`${table.isOverloaded} = true`),
  ],
);

export const classTimeslotTable = pgTable(
  "class_timeslots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schoolsTable.id, { onDelete: "cascade" }),
    classId: uuid("class_id")
      .notNull()
      .references(() => classesTable.id, { onDelete: "cascade" }),
    dayOfWeek: dayOfWeekEnum("day_of_week").notNull(),
    periodNumber: integer("period_number").notNull(),
    subject: text("subject").notNull(),
    teacherAuthId: text("teacher_auth_id").references(
      () => userProfilesTable.authUserId,
    ),
    lessonStartsAt: time("lesson_starts_at", { withTimezone: false }).notNull(),
    lessonEndsAt: time("lesson_ends_at", { withTimezone: false }).notNull(),
    room: text("room"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("class_timeslots_identity_unique").on(
      table.classId,
      table.dayOfWeek,
      table.periodNumber,
    ),
    index("class_timeslots_teacher_idx").on(table.teacherAuthId),
    index("class_timeslots_class_day_idx").on(table.classId, table.dayOfWeek),
    check(
      "class_timeslots_time_check",
      sql`${table.lessonEndsAt} > ${table.lessonStartsAt}`,
    ),
  ],
);

export const teacherLeaveRequestsTable = pgTable(
  "teacher_leave_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schoolsTable.id, { onDelete: "cascade" }),
    teacherAuthId: text("teacher_auth_id")
      .notNull()
      .references(() => userProfilesTable.authUserId),
    leaveType: leaveTypeEnum("leave_type").notNull(),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }).notNull(),
    reason: text("reason"),
    status: leaveRequestStatusEnum("status").notNull().default("pending"),
    reviewedByAuthId: text("reviewed_by_auth_id").references(
      () => userProfilesTable.authUserId,
    ),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("teacher_leave_requests_school_idx").on(table.schoolId),
    index("teacher_leave_requests_teacher_idx").on(table.teacherAuthId),
    index("teacher_leave_requests_status_idx").on(table.status),
    index("teacher_leave_requests_dates_idx").on(table.startDate, table.endDate),
    check(
      "teacher_leave_requests_dates_check",
      sql`${table.endDate} >= ${table.startDate}`,
    ),
  ],
);

export const teacherLeaveBalancesTable = pgTable(
  "teacher_leave_balances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schoolsTable.id, { onDelete: "cascade" }),
    teacherAuthId: text("teacher_auth_id")
      .notNull()
      .references(() => userProfilesTable.authUserId),
    academicYearId: uuid("academic_year_id"),
    leaveType: leaveTypeEnum("leave_type").notNull(),
    totalEntitled: decimal("total_entitled", { precision: 8, scale: 2 })
      .notNull()
      .default("0"),
    used: decimal("used", { precision: 8, scale: 2 }).notNull().default("0"),
    balance: decimal("balance", { precision: 8, scale: 2 }).notNull().default("0"),
    calculatedAt: timestamp("calculated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("teacher_leave_balances_identity_unique").on(
      table.schoolId,
      table.teacherAuthId,
      table.academicYearId,
      table.leaveType,
    ),
    index("teacher_leave_balances_school_idx").on(table.schoolId),
  ],
);

export type StaffEmploymentRecord = typeof staffEmploymentRecordsTable.$inferSelect;
export type TeacherWorkload = typeof teacherWorkloadTable.$inferSelect;
export type ClassTimeslot = typeof classTimeslotTable.$inferSelect;
export type TeacherLeaveRequest = typeof teacherLeaveRequestsTable.$inferSelect;
export type TeacherLeaveBalance = typeof teacherLeaveBalancesTable.$inferSelect;
export type EmploymentType = (typeof employmentTypeEnum.enumValues)[number];
export type EmploymentStatus = (typeof employmentStatusEnum.enumValues)[number];
export type LeaveType = (typeof leaveTypeEnum.enumValues)[number];
export type LeaveRequestStatus = (typeof leaveRequestStatusEnum.enumValues)[number];
export type DayOfWeek = (typeof dayOfWeekEnum.enumValues)[number];
