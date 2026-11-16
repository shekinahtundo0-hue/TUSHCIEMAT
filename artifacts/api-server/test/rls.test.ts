import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import { asUser, startTestDatabase, type TestDatabase } from "./support/database";
import { USERS, buildFixture, hashToken, newToken, syncProfile, type Fixture } from "./support/fixture";

let db: TestDatabase;
let api: pg.Pool;
let fx: Fixture;

async function rows(user: string | null, text: string, values: unknown[] = []) {
  return asUser(api, user, async (c) => (await c.query(text, values)).rows);
}

async function denied(promise: Promise<unknown>, pattern: RegExp | string) {
  await assert.rejects(promise, (error: Error & { code?: string }) => {
    const text = `${error.code} ${error.message}`;
    return typeof pattern === "string" ? text.includes(pattern) : pattern.test(text);
  });
}

before(async () => {
  db = await startTestDatabase();
  api = new pg.Pool({ connectionString: db.apiUrl, max: 6 });
  fx = await buildFixture(api);
});

after(async () => {
  await api?.end();
  await db?.stop();
});

describe("database role", () => {
  it("tushciemat_api cannot bypass RLS and is not a superuser", async () => {
    const [role] = (
      await db.owner.query(
        "SELECT rolsuper, rolbypassrls, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname = 'tushciemat_api'",
      )
    ).rows;
    assert.deepEqual(role, { rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false });
  });

  it("every application table has RLS enabled", async () => {
    const unprotected = (
      await db.owner.query(
        `SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity`,
      )
    ).rows;
    assert.deepEqual(unprotected, []);
  });

  it("requests without a verified identity see nothing", async () => {
    for (const table of ["schools", "students", "school_memberships", "attendance_records", "guardians", "user_profiles"]) {
      assert.equal((await rows(null, `SELECT 1 FROM ${table}`)).length, 0, table);
    }
  });

  it("cannot delete school records", async () => {
    await denied(rows(USERS.ownerA, "DELETE FROM students WHERE id = $1", [fx.student1]), "permission denied");
  });
});

describe("tenant isolation", () => {
  it("an owner sees only their own school", async () => {
    const schools = await rows(USERS.ownerB, "SELECT id FROM schools");
    assert.deepEqual(schools.map((s) => s.id), [fx.schoolB]);
    const students = await rows(USERS.ownerB, "SELECT id FROM students");
    assert.deepEqual(students.map((s) => s.id), [fx.studentB]);
  });

  it("an outsider sees no school data", async () => {
    assert.equal((await rows(USERS.outsider, "SELECT 1 FROM schools")).length, 0);
    assert.equal((await rows(USERS.outsider, "SELECT 1 FROM students")).length, 0);
  });

  it("cannot write into another school", async () => {
    await denied(
      rows(USERS.ownerB, `INSERT INTO students (school_id, first_name, last_name, admission_number) VALUES ($1, 'X', 'Y', 'Z-1')`, [fx.schoolA]),
      "row-level security",
    );
    const updated = await rows(USERS.ownerB, "UPDATE students SET first_name = 'Hacked' WHERE id = $1 RETURNING id", [fx.student1]);
    assert.equal(updated.length, 0);
  });

  it("rejects cross-school references even inside one's own school", async () => {
    await denied(
      rows(USERS.ownerB, `INSERT INTO students (school_id, class_id, first_name, last_name, admission_number) VALUES ($1, $2, 'X', 'Y', 'B-9')`, [fx.schoolB, fx.class1]),
      "23514",
    );
  });
});

describe("role-aware access", () => {
  it("staff and bursars see every student in their school", async () => {
    for (const user of [USERS.ownerA, USERS.adminA, USERS.bursarA]) {
      const ids = (await rows(user, "SELECT id FROM students ORDER BY admission_number")).map((s) => s.id);
      assert.deepEqual(ids, [fx.student1, fx.student2], user);
    }
  });

  it("a teacher sees only students in assigned classes", async () => {
    const ids = (await rows(USERS.teacherA, "SELECT id FROM students")).map((s) => s.id);
    assert.deepEqual(ids, [fx.student1]);
    assert.equal((await rows(USERS.teacherA2, "SELECT 1 FROM students")).length, 0);
  });

  it("a teacher can take attendance only for an assigned class", async () => {
    await rows(USERS.teacherA, `INSERT INTO attendance_records (school_id, class_id, student_id, attendance_date, status, recorded_by)
      VALUES ($1, $2, $3, '2026-03-02', 'present', $4)`, [fx.schoolA, fx.class1, fx.student1, USERS.teacherA]);
    await denied(
      rows(USERS.teacherA, `INSERT INTO attendance_records (school_id, class_id, student_id, attendance_date, status, recorded_by)
        VALUES ($1, $2, $3, '2026-03-02', 'present', $4)`, [fx.schoolA, fx.class2, fx.student2, USERS.teacherA]),
      "row-level security",
    );
  });

  it("attendance must be recorded under the caller's own identity", async () => {
    await denied(
      rows(USERS.teacherA, `INSERT INTO attendance_records (school_id, class_id, student_id, attendance_date, status, recorded_by)
        VALUES ($1, $2, $3, '2026-03-03', 'present', $4)`, [fx.schoolA, fx.class1, fx.student1, USERS.ownerA]),
      "row-level security",
    );
  });

  it("a teacher cannot register students", async () => {
    await denied(
      rows(USERS.teacherA, `INSERT INTO students (school_id, first_name, last_name, admission_number) VALUES ($1, 'X', 'Y', 'A-99')`, [fx.schoolA]),
      "row-level security",
    );
  });

  it("a bursar cannot read attendance", async () => {
    assert.equal((await rows(USERS.bursarA, "SELECT 1 FROM attendance_records")).length, 0);
  });

  it("a parent sees only their linked child and that child's attendance", async () => {
    const ids = (await rows(USERS.parentA, "SELECT id FROM students")).map((s) => s.id);
    assert.deepEqual(ids, [fx.student1]);
    const attendance = await rows(USERS.parentA, "SELECT student_id FROM attendance_records");
    assert.ok(attendance.length > 0 && attendance.every((r) => r.student_id === fx.student1));
    assert.deepEqual((await rows(USERS.parentA, "SELECT id FROM school_classes")).map((row) => row.id), [fx.class1]);
  });

  it("a learner sees only their own record", async () => {
    const ids = (await rows(USERS.studentA, "SELECT id FROM students")).map((s) => s.id);
    assert.deepEqual(ids, [fx.student1]);
    assert.equal((await rows(USERS.studentA, "SELECT 1 FROM guardians")).length, 0);
  });

  it("even managers can select only their own full profile", async () => {
    for (const user of [USERS.ownerA, USERS.adminA, USERS.bursarA, USERS.teacherA, USERS.parentA, USERS.studentA]) {
      const own = await rows(user, "SELECT auth_user_id FROM user_profiles");
      assert.deepEqual(own.map((r) => r.auth_user_id), [user]);
    }
  });
});

describe("privilege escalation", () => {
  it("nobody can grant themselves platform access", async () => {
    await denied(rows(USERS.ownerA, "UPDATE user_profiles SET platform_role = 'platform_admin' WHERE auth_user_id = $1", [USERS.ownerA]), "permission denied");
  });

  it("a profile can only be synced for the verified identity", async () => {
    await denied(
      asUser(api, USERS.outsider, (c) => c.query("SELECT app_private.sync_user_profile($1, 'x', 'x@example.test', NULL)", [USERS.ownerA])),
      "verified identity",
    );
  });

  it("a teacher cannot change memberships", async () => {
    const updated = await rows(USERS.teacherA, "UPDATE school_memberships SET role = 'school_admin' WHERE auth_user_id = $1 RETURNING id", [USERS.teacherA]);
    assert.equal(updated.length, 0);
    await denied(
      rows(USERS.teacherA, "INSERT INTO school_memberships (school_id, auth_user_id, role) VALUES ($1, $2, 'school_admin')", [fx.schoolA, USERS.outsider]),
      /row-level security|only an owner/,
    );
  });

  it("an admin cannot change their own role or grant themselves another", async () => {
    await denied(rows(USERS.adminA, "UPDATE school_memberships SET role = 'owner' WHERE auth_user_id = $1", [USERS.adminA]), /your own role|revoke explicit capabilities/);
    await denied(
      rows(USERS.adminA, "INSERT INTO school_memberships (school_id, auth_user_id, role) VALUES ($1, $2, 'principal')", [fx.schoolA, USERS.adminA]),
      "grant yourself",
    );
  });

  it("only an owner can grant or remove the owner role", async () => {
    await denied(rows(USERS.adminA, "UPDATE school_memberships SET role = 'owner' WHERE auth_user_id = $1", [USERS.teacherA]), "only an owner");
    await denied(rows(USERS.adminA, "UPDATE school_memberships SET status = 'suspended' WHERE auth_user_id = $1", [USERS.ownerA]), /only an owner|last active owner/);
    await denied(
      rows(USERS.adminA, `INSERT INTO invitations (school_id, email, role, token_hash, invited_by_user_id, expires_at)
        VALUES ($1, 'x@example.test', 'owner', $2, $3, now() + interval '1 day')`, [fx.schoolA, hashToken(newToken()), USERS.adminA]),
      "only an owner",
    );
  });

  it("an owner cannot bootstrap ownership of an existing school", async () => {
    await denied(
      rows(USERS.ownerB, "INSERT INTO school_memberships (school_id, auth_user_id, role) VALUES ($1, $2, 'owner')", [fx.schoolA, USERS.ownerB]),
      /grant yourself|row-level security/,
    );
  });

  it("accounts are linked to student records only through invitations", async () => {
    await denied(rows(USERS.adminA, "UPDATE students SET auth_user_id = $1 WHERE id = $2", [USERS.outsider, fx.student2]), "permission denied");
    await denied(
      rows(USERS.adminA, `INSERT INTO students (school_id, first_name, last_name, admission_number, auth_user_id) VALUES ($1, 'X', 'Y', 'A-50', $2)`, [fx.schoolA, USERS.outsider]),
      "accepted invitation",
    );
  });

  it("tenant and identity columns are immutable through the API", async () => {
    await denied(rows(USERS.ownerA, "UPDATE students SET school_id = $1 WHERE id = $2", [fx.schoolB, fx.student1]), "permission denied");
    await denied(rows(USERS.ownerA, "UPDATE school_memberships SET auth_user_id = $1 WHERE auth_user_id = $2", [USERS.outsider, USERS.teacherA]), "permission denied");
  });
});

describe("invitations", () => {
  async function invite(email: string, role: string, extra: { studentId?: string; guardianId?: string; expires?: string } = {}) {
    const token = newToken();
    await rows(USERS.adminA, `INSERT INTO invitations (school_id, email, role, token_hash, student_id, guardian_id, invited_by_user_id, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, now() + $8::interval)`,
      [fx.schoolA, email, role, hashToken(token), extra.studentId ?? null, extra.guardianId ?? null, USERS.adminA, extra.expires ?? "7 days"]);
    return hashToken(token);
  }
  const accept = (user: string, hash: string) => rows(user, "SELECT * FROM app_private.accept_invitation($1)", [hash]);

  it("requires the signed-in account's email to match", async () => {
    const hash = await invite("someone-else@example.test", "teacher");
    await denied(accept(USERS.outsider, hash), "different email");
  });

  it("cannot be accepted after expiry or twice", async () => {
    const expired = await invite("outsider@example.test", "teacher", { expires: "-1 minute" });
    await denied(accept(USERS.outsider, expired), "not valid");
  });

  it("is accepted exactly once under concurrency", async () => {
    await syncProfile(api, "user_racer", "racer@example.test");
    const hash = await invite("racer@example.test", "tutor");
    const results = await Promise.allSettled([accept("user_racer", hash), accept("user_racer", hash), accept("user_racer", hash)]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const memberships = await rows(USERS.adminA, "SELECT 1 FROM school_memberships WHERE auth_user_id = 'user_racer'");
    assert.equal(memberships.length, 1);
  });

  it("a revoked invitation cannot be accepted or reopened", async () => {
    await syncProfile(api, "user_revoked", "revoked@example.test");
    const hash = await invite("revoked@example.test", "teacher");
    await rows(USERS.adminA, "UPDATE invitations SET status = 'revoked' WHERE token_hash = $1", [hash]);
    await denied(accept("user_revoked", hash), "not valid");
    await denied(rows(USERS.adminA, "UPDATE invitations SET status = 'pending' WHERE token_hash = $1", [hash]), "only pending");
  });

  it("only owners and admins can see invitations", async () => {
    assert.ok((await rows(USERS.adminA, "SELECT 1 FROM invitations")).length > 0);
    assert.equal((await rows(USERS.teacherA, "SELECT 1 FROM invitations")).length, 0);
  });
});

describe("transactions", () => {
  it("a failure rolls back every write in the request", async () => {
    await assert.rejects(
      asUser(api, USERS.ownerA, async (c) => {
        await c.query(`INSERT INTO students (school_id, first_name, last_name, admission_number) VALUES ($1, 'Roll', 'Back', 'A-RB')`, [fx.schoolA]);
        await c.query(`INSERT INTO students (school_id, first_name, last_name, admission_number) VALUES ($1, 'Dup', 'Licate', 'A-001')`, [fx.schoolA]);
      }),
      (error: Error & { code?: string }) => error.code === "23505",
    );
    assert.equal((await rows(USERS.ownerA, "SELECT 1 FROM students WHERE admission_number = 'A-RB'")).length, 0);
  });

  it("identity does not leak between pooled transactions", async () => {
    const single = new pg.Pool({ connectionString: db.apiUrl, max: 1 });
    try {
      await asUser(single, USERS.ownerA, (c) => c.query("SELECT 1"));
      const [row] = await asUser(single, null, async (c) => (await c.query("SELECT app_private.current_user_id() AS id, pg_backend_pid() AS pid")).rows);
      assert.equal(row.id, null);
    } finally {
      await single.end();
    }
  });
});
