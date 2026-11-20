import { createHash, randomBytes } from "node:crypto";
import type pg from "pg";
import { asUser } from "./database";

export const USERS = {
  ownerA: "user_ownerA",
  adminA: "user_adminA",
  teacherA: "user_teacherA",
  teacherA2: "user_teacherA2",
  bursarA: "user_bursarA",
  parentA: "user_parentA",
  studentA: "user_studentA",
  ownerB: "user_ownerB",
  outsider: "user_outsider",
} as const;

export type Fixture = {
  schoolA: string;
  schoolB: string;
  yearA: string;
  yearB: string;
  class1: string;
  class2: string;
  classB: string;
  student1: string;
  student2: string;
  studentB: string;
  guardian1: string;
};

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

async function one<T = Record<string, string>>(
  client: pg.PoolClient,
  text: string,
  values: unknown[] = [],
): Promise<T> {
  const result = await client.query(text, values);
  if (result.rows.length !== 1) throw new Error(`expected one row from: ${text}`);
  return result.rows[0] as T;
}

export async function syncProfile(api: pg.Pool, authUserId: string, email?: string) {
  await asUser(api, authUserId, (c) =>
    c.query("SELECT app_private.sync_user_profile($1, $2, $3, NULL)", [
      authUserId,
      authUserId.replace("user_", ""),
      email ?? `${authUserId.replace("user_", "").toLowerCase()}@example.test`,
    ]),
  );
}

async function createSchool(api: pg.Pool, ownerId: string, name: string, slug: string) {
  return asUser(api, ownerId, async (c) => {
    const school = await one(
      c,
      `INSERT INTO schools (name, slug, category, curriculum, created_by_user_id)
       VALUES ($1, $2, 'secondary', 'CBC', $3) RETURNING id`,
      [name, slug, ownerId],
    );
    await c.query(
      `INSERT INTO school_memberships (school_id, auth_user_id, role) VALUES ($1, $2, 'owner')`,
      [school.id, ownerId],
    );
    const year = await one(
      c,
      `INSERT INTO academic_years (school_id, name, starts_on, ends_on, is_current)
       VALUES ($1, '2026', '2026-01-05', '2026-11-27', true) RETURNING id`,
      [school.id],
    );
    return { schoolId: school.id, yearId: year.id };
  });
}

/** Builds two schools entirely through the least-privilege API role. */
export async function buildFixture(api: pg.Pool): Promise<Fixture> {
  for (const id of Object.values(USERS)) await syncProfile(api, id);

  const a = await createSchool(api, USERS.ownerA, "Amani Secondary", "amani-secondary");
  const b = await createSchool(api, USERS.ownerB, "Baraka Academy", "baraka-academy");

  const ids = await asUser(api, USERS.ownerA, async (c) => {
    let adminMembershipId = "";
    for (const [user, role] of [
      [USERS.adminA, "school_admin"],
      [USERS.teacherA, "teacher"],
      [USERS.teacherA2, "teacher"],
      [USERS.bursarA, "bursar"],
    ] as const) {
      const inserted = await one(
        c,
        `INSERT INTO school_memberships (school_id, auth_user_id, role) VALUES ($1, $2, $3) RETURNING id`,
        [a.schoolId, user, role],
      );
      if (user === USERS.adminA) adminMembershipId = inserted.id;
    }
    // Mirrors the production backfill: existing co-administrators keep every
    // capability except records.delete. New school_admins start with none.
    await c.query(`SELECT app_private.set_member_capabilities($1, $2, $3::text[])`, [
      a.schoolId,
      adminMembershipId,
      [
        "students.manage", "academics.manage", "attendance.manage", "people.manage",
        "requests.review", "settings.manage", "announcements.manage",
        "assessments.manage", "results.publish", "resources.manage",
        "staff.manage", "workload.manage", "communications.manage", "classroom.manage",
      ],
    ]);
    const class1 = await one(
      c,
      `INSERT INTO school_classes (school_id, academic_year_id, name, grade, stream)
       VALUES ($1, $2, 'Form 1 East', 'Form 1', 'East') RETURNING id`,
      [a.schoolId, a.yearId],
    );
    const class2 = await one(
      c,
      `INSERT INTO school_classes (school_id, academic_year_id, name, grade, stream)
       VALUES ($1, $2, 'Form 1 West', 'Form 1', 'West') RETURNING id`,
      [a.schoolId, a.yearId],
    );
    const student1 = await one(
      c,
      `INSERT INTO students (school_id, class_id, first_name, last_name, admission_number)
       VALUES ($1, $2, 'Wanjiru', 'Kamau', 'A-001') RETURNING id`,
      [a.schoolId, class1.id],
    );
    const student2 = await one(
      c,
      `INSERT INTO students (school_id, class_id, first_name, last_name, admission_number)
       VALUES ($1, $2, 'Otieno', 'Odhiambo', 'A-002') RETURNING id`,
      [a.schoolId, class2.id],
    );
    const guardian1 = await one(
      c,
      `INSERT INTO guardians (school_id, full_name, email) VALUES ($1, 'Parent A', 'parenta@example.test') RETURNING id`,
      [a.schoolId],
    );
    await c.query(
      `INSERT INTO student_guardians (school_id, student_id, guardian_id, relationship, is_primary)
       VALUES ($1, $2, $3, 'mother', true)`,
      [a.schoolId, student1.id, guardian1.id],
    );
    await c.query(
      `INSERT INTO class_teacher_assignments (school_id, class_id, teacher_user_id, assignment_role, created_by_user_id)
       VALUES ($1, $2, $3, 'class_teacher', $4)`,
      [a.schoolId, class1.id, USERS.teacherA, USERS.ownerA],
    );
    return {
      class1: class1.id,
      class2: class2.id,
      student1: student1.id,
      student2: student2.id,
      guardian1: guardian1.id,
    };
  });

  const bIds = await asUser(api, USERS.ownerB, async (c) => {
    const classB = await one(
      c,
      `INSERT INTO school_classes (school_id, academic_year_id, name, grade)
       VALUES ($1, $2, 'Grade 7', 'Grade 7') RETURNING id`,
      [b.schoolId, b.yearId],
    );
    const studentB = await one(
      c,
      `INSERT INTO students (school_id, class_id, first_name, last_name, admission_number)
       VALUES ($1, $2, 'Baraka', 'Mwangi', 'B-001') RETURNING id`,
      [b.schoolId, classB.id],
    );
    return { classB: classB.id, studentB: studentB.id };
  });

  // Parent and learner accounts are linked only by accepting invitations.
  for (const [user, role, column, recordId] of [
    [USERS.parentA, "parent", "guardian_id", ids.guardian1],
    [USERS.studentA, "student", "student_id", ids.student1],
  ] as const) {
    const token = newToken();
    await asUser(api, USERS.adminA, (c) =>
      c.query(
        `INSERT INTO invitations (school_id, email, role, token_hash, ${column}, invited_by_user_id, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, now() + interval '7 days')`,
        [a.schoolId, `${user.replace("user_", "").toLowerCase()}@example.test`, role, hashToken(token), recordId, USERS.adminA],
      ),
    );
    await asUser(api, user, (c) =>
      c.query("SELECT * FROM app_private.accept_invitation($1)", [hashToken(token)]),
    );
  }

  return {
    schoolA: a.schoolId,
    schoolB: b.schoolId,
    yearA: a.yearId,
    yearB: b.yearId,
    ...ids,
    ...bIds,
  };
}
