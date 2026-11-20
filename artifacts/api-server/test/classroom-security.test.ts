import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { createLocalJWKSet, SignJWT } from "jose";
import pg from "pg";
import pino from "pino";
import { createApp } from "../src/app";
import { loadConfig } from "../src/config/env";
import { createDatabase } from "../src/lib/database";
import { firebaseIdentityVerifier } from "../src/lib/identity";
import { asUser, startTestDatabase, type TestDatabase } from "./support/database";
import { buildFixture, USERS, type Fixture } from "./support/fixture";

let db: TestDatabase;
let api: pg.Pool;
let fx: Fixture;
let server: Server;
let baseUrl: string;
let extraStudent: string;
const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const project = "classroom-security-test";
const family = [USERS.studentA, USERS.parentA];

async function rows(user: string | null, text: string, values: unknown[] = []) {
  return asUser(api, user, async (client) => (await client.query(text, values)).rows);
}

async function denied(promise: Promise<unknown>, code: string, message: RegExp) {
  await assert.rejects(promise, (error: Error & { code?: string }) => {
    assert.equal(error.code, code);
    assert.match(error.message, message);
    return true;
  });
}

async function request(user: string, method: string, path: string, body?: unknown, school = fx.schoolA) {
  const handle = user.replace("user_", "");
  const token = await new SignJWT({
    auth_time: Math.floor(Date.now() / 1000) - 30,
    name: handle,
    email: `${handle.toLowerCase()}@example.test`,
    email_verified: true,
  }).setProtectedHeader({ alg: "RS256", kid: "local-test" })
    .setSubject(user).setIssuer(`https://securetoken.google.com/${project}`)
    .setAudience(project).setIssuedAt().setExpirationTime("2m").sign(keys.privateKey);
  const response = await fetch(`${baseUrl}/api/v1${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "x-school-id": school, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json() as {
    data?: Array<{ id: string }>;
    total?: number;
    error?: { code: string };
    status?: string;
    marksObtained?: number;
  };
  return { status: response.status, json };
}

function expectHttp(result: Awaited<ReturnType<typeof request>>, status: number, code?: string) {
  assert.equal(result.status, status, JSON.stringify(result.json));
  if (code) assert.equal(result.json.error?.code, code);
}

async function assignment(user = USERS.ownerA as string, school = fx.schoolA, classId = fx.class1) {
  const [row] = await rows(user,
    `INSERT INTO assignments (school_id, class_id, subject, title, marks_allocated,
       deadline_date, allow_resubmission, created_by_user_id)
     VALUES ($1, $2, 'Mathematics', $3, 20, current_date + 30, true, $4) RETURNING id`,
    [school, classId, `Security ${randomUUID()}`, user]);
  return row.id as string;
}

async function submit(assignmentId: string) {
  const [row] = await rows(USERS.studentA,
    `INSERT INTO assignment_submissions (school_id, assignment_id, student_id, submission_text, status, submitted_at)
     VALUES ($1, $2, $3, 'Original answer', 'submitted', now()) RETURNING id`,
    [fx.schoolA, assignmentId, fx.student1]);
  return row.id as string;
}

async function grade(id: string, user = USERS.teacherA as string, marks = 20, grader: string | null = user) {
  return rows(user,
    `UPDATE assignment_submissions SET marks_obtained = $2, feedback = 'Reviewed',
       marked_at = now(), graded_by_user_id = $3, status = 'graded' WHERE id = $1 RETURNING *`,
    [id, marks, grader]);
}

before(async () => {
  // Always an isolated embedded PostgreSQL instance; never use an environment DB URL.
  db = await startTestDatabase();
  api = new pg.Pool({ connectionString: db.apiUrl, max: 6 });
  fx = await buildFixture(api);
  const [student] = await rows(USERS.ownerA,
    `INSERT INTO students (school_id, class_id, first_name, last_name, admission_number)
     VALUES ($1, $2, 'Unlinked', 'Classmate', 'A-SECURITY') RETURNING id`, [fx.schoolA, fx.class1]);
  extraStudent = student.id;
  const config = loadConfig({ NODE_ENV: "test", PORT: "1", DATABASE_URL: db.apiUrl,
    FIREBASE_PROJECT_ID: project, CORS_ALLOWED_ORIGINS: "http://localhost:5173" });
  const identity = firebaseIdentityVerifier(project, createLocalJWKSet({
    keys: [{ ...keys.publicKey.export({ format: "jwk" }), kid: "local-test", alg: "RS256", use: "sig" }],
  }));
  server = createApp({ config, identity, database: createDatabase(api), logger: pino({ level: "silent" }) })
    .listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => server
    ? server.close((error) => error ? reject(error) : resolve()) : resolve());
  await api?.end();
  await db?.stop();
});

describe("assignment submission guard", () => {
  it("runs with the restricted API login and an invoker trigger with a pinned search path", async () => {
    const [role] = await rows(USERS.studentA,
      "SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user");
    assert.deepEqual(role, { current_user: "tushciemat_api", rolsuper: false, rolbypassrls: false });
    const [fn] = (await db.owner.query(
      `SELECT prosecdef, proconfig FROM pg_proc
       WHERE oid = 'app_private.guard_assignment_submission()'::regprocedure`)).rows;
    assert.equal(fn.prosecdef, false);
    assert.deepEqual(fn.proconfig, ['search_path=""']);
  });

  const gradingFields = [
    ["marks_obtained", "10"],
    ["feedback", "'Self-approved'"],
    ["marked_at", "now()"],
    ["graded_by_user_id", "'user_studentA'"],
    ["status", "'graded'"],
  ];
  for (const [field, value] of gradingFields) {
    it(`rejects learner INSERT with ${field}`, async () => {
      const id = await assignment();
      await denied(rows(USERS.studentA,
        `INSERT INTO assignment_submissions (school_id, assignment_id, student_id, ${field})
         VALUES ($1, $2, $3, ${value})`, [fx.schoolA, id, fx.student1]), "42501", /may grade/);
      assert.deepEqual(await rows(USERS.studentA,
        "SELECT id FROM assignment_submissions WHERE assignment_id = $1", [id]), []);
    });
    it(`rejects learner UPDATE of ${field}`, async () => {
      const id = await submit(await assignment());
      await denied(rows(USERS.studentA,
        `UPDATE assignment_submissions SET ${field} = ${value} WHERE id = $1`, [id]), "42501", /may grade/);
    });
  }

  it("permits ordinary learner submission, editing and resubmission", async () => {
    const id = await submit(await assignment());
    for (const status of ["in_progress", "submitted"]) {
      const [row] = await rows(USERS.studentA,
        `UPDATE assignment_submissions SET submission_text = 'Revised answer', submitted_files = '[]',
           submitted_at = now(), status = $2, updated_at = now() WHERE id = $1 RETURNING *`, [id, status]);
      assert.equal(row.submission_text, "Revised answer");
      assert.equal(row.status, status);
      assert.equal(row.marks_obtained, null);
      assert.equal(row.graded_by_user_id, null);
    }
  });

  it("keeps id, school, assignment and student immutable even for an authorized teacher", async () => {
    const id = await submit(await assignment());
    const otherAssignment = await assignment();
    for (const user of [USERS.studentA, USERS.teacherA]) {
      for (const [field, value] of [["id", randomUUID()], ["school_id", fx.schoolB],
        ["assignment_id", otherAssignment], ["student_id", extraStudent]]) {
        await denied(rows(user, `UPDATE assignment_submissions SET ${field} = $2 WHERE id = $1`, [id, value]),
          "23514", /identity cannot be changed/);
      }
    }
  });

  it("rejects cross-school and wrong-class submission references", async () => {
    const local = await assignment();
    const otherClass = await assignment(USERS.ownerA, fx.schoolA, fx.class2);
    const foreign = await assignment(USERS.ownerB, fx.schoolB, fx.classB);
    for (const [school, id, student] of [[fx.schoolB, local, fx.student1], [fx.schoolA, otherClass, fx.student1],
      [fx.schoolA, foreign, fx.student1], [fx.schoolA, local, fx.studentB]]) {
      await denied(rows(USERS.studentA,
        "INSERT INTO assignment_submissions (school_id, assignment_id, student_id) VALUES ($1, $2, $3)",
        [school, id, student]), "23514", /same school and class/);
    }
  });

  it("allows assigned teachers and classroom-capable staff to mark with their own attribution", async () => {
    const id = await submit(await assignment());
    for (const user of [USERS.teacherA, USERS.adminA, USERS.ownerA]) {
      const [row] = await grade(id, user);
      assert.equal(row.marks_obtained, "20.00");
      assert.equal(row.status, "graded");
      assert.equal(row.graded_by_user_id, user);
      assert.ok(row.marked_at);
    }
  });

  it("allows classroom.manage-only admins to mark through SQL and HTTP without student SELECT access", async () => {
    const assignmentId = await assignment();
    const id = await submit(assignmentId);
    const [membership] = await rows(USERS.ownerA,
      "SELECT id FROM school_memberships WHERE school_id = $1 AND auth_user_id = $2",
      [fx.schoolA, USERS.adminA]);
    const originalCapabilities = (await rows(USERS.ownerA,
      "SELECT capability FROM membership_capabilities WHERE membership_id = $1", [membership.id]))
      .map((row) => row.capability);
    try {
      await rows(USERS.ownerA, "SELECT app_private.set_member_capabilities($1, $2, $3::text[])",
        [fx.schoolA, membership.id, ["classroom.manage"]]);
      assert.deepEqual(await rows(USERS.adminA,
        "SELECT capability FROM membership_capabilities WHERE membership_id = $1", [membership.id]),
      [{ capability: "classroom.manage" }]);
      assert.deepEqual(await rows(USERS.adminA, "SELECT id FROM students"), []);
      const [sqlMarked] = await grade(id, USERS.adminA, 17);
      assert.equal(sqlMarked.marks_obtained, "17.00");
      assert.equal(sqlMarked.graded_by_user_id, USERS.adminA);
      assert.equal(sqlMarked.status, "graded");
      assert.ok(sqlMarked.marked_at);

      const marked = await request(USERS.adminA, "POST",
        `/assignments/${assignmentId}/submissions/${id}/mark`, { marksObtained: 18, feedback: "Admin review" });
      expectHttp(marked, 200);
      assert.equal(marked.json.marksObtained, 18);
      const [saved] = await rows(USERS.adminA, "SELECT * FROM assignment_submissions WHERE id = $1", [id]);
      assert.equal(saved.marks_obtained, "18.00");
      assert.equal(saved.graded_by_user_id, USERS.adminA);
      assert.equal(saved.status, "graded");
      assert.equal(saved.feedback, "Admin review");
      assert.ok(saved.marked_at);
    } finally {
      await rows(USERS.ownerA, "SELECT app_private.set_member_capabilities($1, $2, $3::text[])",
        [fx.schoolA, membership.id, originalCapabilities]);
    }
  });

  it("allows owners and the original teacher to grade historical submissions after a class transfer", async () => {
    const assignmentId = await assignment();
    const id = await submit(assignmentId);
    const [student] = await rows(USERS.ownerA, "SELECT class_id FROM students WHERE id = $1", [fx.student1]);
    assert.equal(student.class_id, fx.class1);
    try {
      const [transferred] = await rows(USERS.ownerA,
        "UPDATE students SET class_id = $2 WHERE id = $1 RETURNING class_id", [fx.student1, fx.class2]);
      assert.equal(transferred.class_id, fx.class2);
      assert.deepEqual(await rows(USERS.teacherA, "SELECT id FROM students WHERE id = $1", [fx.student1]), []);
      for (const user of [USERS.ownerA, USERS.teacherA]) {
        const [marked] = await grade(id, user, 19);
        assert.equal(marked.marks_obtained, "19.00");
        assert.equal(marked.graded_by_user_id, user);
        assert.equal(marked.status, "graded");
        assert.ok(marked.marked_at);
        assert.equal(marked.assignment_id, assignmentId);
        assert.equal(marked.student_id, fx.student1);
      }
    } finally {
      await rows(USERS.ownerA, "UPDATE students SET class_id = $2 WHERE id = $1", [fx.student1, student.class_id]);
    }
  });

  it("rejects over-maximum/negative marks and missing or forged grader attribution", async () => {
    const id = await submit(await assignment());
    for (const marks of [-1, 20.01]) {
      await denied(grade(id, USERS.teacherA, marks), "23514", /assignment maximum/);
    }
    for (const grader of [null, USERS.ownerA, USERS.studentA]) {
      await denied(grade(id, USERS.teacherA, 10, grader), "42501", /grader must be the current user/);
    }
    assert.equal((await grade(id, USERS.teacherA, 0))[0].marks_obtained, "0.00");
  });

  it("does not let unassigned teachers, guardians or another school's owner grade", async () => {
    const id = await submit(await assignment());
    for (const user of [USERS.teacherA2, USERS.parentA, USERS.ownerB]) {
      assert.deepEqual(await grade(id, user), [], user);
    }
    assert.deepEqual(await rows(USERS.ownerB, "SELECT id FROM assignment_submissions WHERE id = $1", [id]), []);
    assert.equal((await rows(USERS.studentA, "SELECT marks_obtained FROM assignment_submissions WHERE id = $1", [id]))[0].marks_obtained, null);
  });

  it("blocks all learner mutations of graded work, including attempts to ungrade or clear marks", async () => {
    const id = await submit(await assignment());
    await grade(id);
    for (const change of ["submission_text = 'Changed after marking'", "submitted_files = '[{}]'",
      "submitted_at = now()", "updated_at = now()", "status = 'submitted'", "marks_obtained = NULL",
      "feedback = NULL", "marked_at = NULL", "graded_by_user_id = NULL"]) {
      await denied(rows(USERS.studentA, `UPDATE assignment_submissions SET ${change} WHERE id = $1`, [id]),
        "42501", /cannot modify graded/);
    }
    assert.equal((await rows(USERS.studentA, "SELECT submission_text FROM assignment_submissions WHERE id = $1", [id]))[0].submission_text, "Original answer");
  });

  it("enforces HTTP maximum marks and graded-work rejection without breaking submit/edit/mark", async () => {
    const id = await assignment();
    const submitPath = `/assignments/${id}/submit`;
    expectHttp(await request(USERS.studentA, "POST", submitPath, { submissionText: "First HTTP answer" }), 201);
    expectHttp(await request(USERS.studentA, "PUT", submitPath, { submissionText: "Edited HTTP answer" }), 200);
    expectHttp(await request(USERS.studentA, "POST", submitPath, { submissionText: "Final HTTP answer" }), 201);
    const [submission] = await rows(USERS.studentA, "SELECT id FROM assignment_submissions WHERE assignment_id = $1", [id]);
    const markPath = `/assignments/${id}/submissions/${submission.id}/mark`;
    expectHttp(await request(USERS.studentA, "POST", markPath, { marksObtained: 20 }), 403);
    expectHttp(await request(USERS.teacherA, "POST", markPath, { marksObtained: 21 }), 400, "marks_exceeded");
    const marked = await request(USERS.teacherA, "POST", markPath, { marksObtained: 18, feedback: "Good work" });
    expectHttp(marked, 200);
    assert.equal(marked.json.marksObtained, 18);
    for (const method of ["POST", "PUT"]) {
      expectHttp(await request(USERS.studentA, method, submitPath, { submissionText: "Tampered" }), 400, "submission_graded");
    }
    expectHttp(await request(USERS.ownerB, "POST", markPath, { marksObtained: 10 }, fx.schoolB), 404);
    expectHttp(await request(USERS.ownerB, "POST", markPath, { marksObtained: 10 }), 403);
    const [saved] = await rows(USERS.studentA, "SELECT * FROM assignment_submissions WHERE id = $1", [submission.id]);
    assert.equal(saved.submission_text, "Final HTTP answer");
    assert.equal(saved.graded_by_user_id, USERS.teacherA);
    assert.equal(saved.marks_obtained, "18.00");
  });
});

describe("learning resource RLS", () => {
  const resources: Record<string, string> = {};
  const visibleNames = ["targeted", "empty restriction", "null restriction"];
  before(async () => {
    const [lesson] = await rows(USERS.teacherA,
      "INSERT INTO class_lessons (school_id, class_id, lesson_name) VALUES ($1, $2, 'Security lesson') RETURNING id",
      [fx.schoolA, fx.class1]);
    const past = new Date(Date.now() - 60_000);
    const future = new Date(Date.now() + 86_400_000);
    const cases = [
      { name: "targeted", restricted: [fx.student1] },
      { name: "empty restriction", restricted: [] },
      { name: "null restriction", restricted: null },
      { name: "other classmate", restricted: [extraStudent] },
      { name: "wrong class target", restricted: [fx.student2] },
      { name: "non-array restriction", restricted: fx.student1 },
      { name: "null publication", published: null },
      { name: "draft", published: null, visible: false },
      { name: "future publication", published: future },
      { name: "expired", expires: past },
      { name: "deleted", deleted: past },
      { name: "other class", classId: fx.class2, restricted: [fx.student1] },
      { name: "other child target", classId: fx.class2, restricted: [fx.student2] },
      { name: "other school", school: fx.schoolB, classId: fx.classB },
      // Deliberately inconsistent legacy reference: class alone must not grant family access.
      { name: "mismatched school", school: fx.schoolB, classId: fx.class1, restricted: [fx.student1] },
    ];
    for (const item of cases) {
      const school = item.school ?? fx.schoolA;
      const user = school === fx.schoolA ? USERS.ownerA : USERS.ownerB;
      const [resource] = await rows(user,
        `INSERT INTO learning_resources (school_id, class_id, lesson_id, title, resource_type, uploaded_by_user_id,
           published_at, is_visible_to_students, restricted_to_student_ids, expires_at, deleted_at)
         VALUES ($1, $2, $3, $4, 'pdf', $5, $6, $7, $8::jsonb, $9, $10) RETURNING id`,
        [school, item.classId ?? fx.class1, school === fx.schoolA ? lesson.id : null, item.name, user,
          item.published === undefined ? past : item.published, item.visible ?? true,
          item.restricted === null ? null : JSON.stringify(item.restricted ?? []), item.expires ?? null, item.deleted ?? null]);
      resources[item.name] = resource.id;
    }
    await rows(USERS.studentA,
      `INSERT INTO student_learning_progress (school_id, class_id, student_id, lesson_id, bookmarked_at)
       VALUES ($1, $2, $3, $4, now())`, [fx.schoolA, fx.class1, fx.student1, lesson.id]);
  });

  it("shows only published, available resources targeted to the same linked student", async () => {
    assert.deepEqual(await rows(USERS.parentA, "SELECT id FROM students WHERE id = $1", [extraStudent]), []);
    for (const user of family) {
      const actual = await rows(user, "SELECT id FROM learning_resources");
      assert.deepEqual(actual.map((r) => r.id).sort(), visibleNames.map((name) => resources[name]).sort(), user);
      for (const [name, id] of Object.entries(resources)) {
        const direct = await rows(user, "SELECT id FROM learning_resources WHERE id = $1", [id]);
        assert.equal(direct.length, visibleNames.includes(name) ? 1 : 0, `${user}: ${name}`);
      }
    }
  });

  it("does not combine one linked child's class with another linked child's resource restriction", async () => {
    const [link] = await rows(USERS.ownerA,
      `INSERT INTO student_guardians (school_id, student_id, guardian_id, relationship)
       VALUES ($1, $2, $3, 'mother') RETURNING id`, [fx.schoolA, fx.student2, fx.guardian1]);
    try {
      const children = await rows(USERS.parentA, "SELECT id, class_id FROM students");
      assert.deepEqual(children.sort((a, b) => a.id.localeCompare(b.id)),
        [{ id: fx.student1, class_id: fx.class1 }, { id: fx.student2, class_id: fx.class2 }]
          .sort((a, b) => a.id.localeCompare(b.id)));
      const allowed = [...visibleNames, "other child target"];
      assert.deepEqual((await rows(USERS.parentA, "SELECT id FROM learning_resources")).map((row) => row.id).sort(),
        allowed.map((name) => resources[name]).sort());
      for (const name of allowed) {
        assert.deepEqual(await rows(USERS.parentA, "SELECT id FROM learning_resources WHERE id = $1", [resources[name]]),
          [{ id: resources[name] }]);
        expectHttp(await request(USERS.parentA, "GET", `/learning/resources/${resources[name]}`), 200);
      }
      for (const name of ["wrong class target", "other class"]) {
        assert.deepEqual(await rows(USERS.parentA, "SELECT id FROM learning_resources WHERE id = $1", [resources[name]]), []);
        expectHttp(await request(USERS.parentA, "GET", `/learning/resources/${resources[name]}`), 404);
      }
      for (const [classId, names] of [[fx.class1, visibleNames], [fx.class2, ["other child target"]]] as const) {
        const list = await request(USERS.parentA, "GET", `/learning/resources?classId=${classId}`);
        expectHttp(list, 200);
        assert.deepEqual(list.json.data?.map((row) => row.id).sort(), names.map((name) => resources[name]).sort());
        assert.equal(list.json.total, names.length);
      }
    } finally {
      await rows(USERS.ownerA, "DELETE FROM student_guardians WHERE id = $1", [link.id]);
    }
    assert.deepEqual(await rows(USERS.parentA, "SELECT id FROM students"), [{ id: fx.student1 }]);
  });

  it("protects HTTP lists, recent resources, bookmarks and guardian detail reads", async () => {
    const expected = visibleNames.map((name) => resources[name]).sort();
    for (const user of family) {
      const list = await request(user, "GET", `/learning/resources?classId=${fx.class1}`);
      expectHttp(list, 200);
      assert.deepEqual(list.json.data?.map((r) => r.id).sort(), expected);
      assert.equal(list.json.total, expected.length);
      for (const name of ["other classmate", "null publication", "draft", "mismatched school"]) {
        expectHttp(await request(user, "GET", `/learning/resources/${resources[name]}`), 404);
      }
      expectHttp(await request(user, "GET", `/learning/resources/${resources.targeted}`), 200);
    }
    for (const path of ["/learning/resources/recent", "/learning/bookmarks"]) {
      const result = await request(USERS.studentA, "GET", path);
      expectHttp(result, 200);
      assert.deepEqual(result.json.data?.map((r) => r.id).sort(), expected);
    }
  });

  it("returns storage unavailable without false download URLs or success logs", async () => {
    const id = resources.targeted;
    const file = {
      id: randomUUID(),
      path: `${fx.schoolA}/${fx.class1}/resources/${randomUUID()}/handout.pdf`,
      name: "handout.pdf",
      size: 2048,
      type: "application/pdf",
    };
    await rows(USERS.ownerA, "UPDATE learning_resources SET attachments = $2::jsonb WHERE id = $1",
      [id, JSON.stringify([file])]);
    try {
      const downloads = () => rows(USERS.ownerA,
        "SELECT id FROM resource_access_logs WHERE resource_id = $1 AND was_downloaded", [id]);
      const before = await downloads();
      const paths = [
        `/learning/resources/${id}/download`,
        `/learning/resources/${id}/files/${file.id}/download`,
        `/learning/resources/${id}/files/${file.id}/preview`,
      ];
      for (const user of [USERS.studentA, USERS.parentA, USERS.teacherA, USERS.ownerA]) {
        for (const path of paths) {
          const result = await request(user, "GET", path);
          expectHttp(result, 503, "storage_unavailable");
          assert.equal("downloadUrl" in result.json, false);
        }
      }
      for (const user of [USERS.ownerB, USERS.teacherA2]) {
        for (const path of paths) {
          expectHttp(await request(user, "GET", path, undefined,
            user === USERS.ownerB ? fx.schoolB : fx.schoolA), 404);
        }
      }
      for (const other of [resources["other classmate"], resources["empty restriction"]]) {
        expectHttp(await request(USERS.studentA, "GET", `/learning/resources/${other}/download`), 404);
      }
      expectHttp(await request(USERS.studentA, "GET",
        `/learning/resources/${id}/files/${randomUUID()}/download`), 404);
      assert.deepEqual(await downloads(), before);
    } finally {
      await rows(USERS.ownerA, "UPDATE learning_resources SET attachments = '[]'::jsonb WHERE id = $1", [id]);
    }
  });

  it("retains staff and assigned-teacher draft/targeted reads but denies unrelated accounts", async () => {
    for (const user of [USERS.ownerA, USERS.adminA, USERS.teacherA]) {
      for (const name of ["other classmate", "draft", "null publication", "expired", "deleted"]) {
        assert.equal((await rows(user, "SELECT id FROM learning_resources WHERE id = $1", [resources[name]])).length, 1);
      }
    }
    for (const user of [USERS.ownerB, USERS.teacherA2, USERS.outsider, null]) {
      assert.deepEqual(await rows(user, "SELECT id FROM learning_resources WHERE id = $1", [resources.targeted]), []);
    }
    for (const user of family) {
      expectHttp(await request(user, "GET", `/learning/resources/${resources["other school"]}`, undefined, fx.schoolB), 403);
    }
  });
});

async function resultSet(user = USERS.ownerA as string, school = fx.schoolA, year = fx.yearA,
  classId = fx.class1, student = fx.student1) {
  const [term] = await rows(user,
    `INSERT INTO terms (school_id, academic_year_id, name, starts_on, ends_on)
     VALUES ($1, $2, $3, '2026-01-05', '2026-04-01') RETURNING id`, [school, year, `Security ${randomUUID()}`]);
  const [type] = await rows(user,
    "INSERT INTO assessment_types (school_id, name, max_marks, created_by_user_id) VALUES ($1, 'Security test', 20, $2) RETURNING id",
    [school, user]);
  const [assessment] = await rows(user,
    `INSERT INTO assessments (school_id, term_id, class_id, assessment_type_id, subject, max_marks, created_by_user_id)
     VALUES ($1, $2, $3, $4, 'Mathematics', 20, $5) RETURNING id`, [school, term.id, classId, type.id, user]);
  const [mark] = await rows(user,
    `INSERT INTO student_assessment_marks (school_id, assessment_id, student_id, marks_obtained)
     VALUES ($1, $2, $3, 15) RETURNING id`, [school, assessment.id, student]);
  const [aggregate] = await rows(user,
    `INSERT INTO student_term_aggregates (school_id, student_id, term_id, class_id, subject, total_marks)
     VALUES ($1, $2, $3, $4, 'Mathematics', 15) RETURNING id`, [school, student, term.id, classId]);
  return { school, term: term.id as string, classId, assessment: assessment.id as string,
    mark: mark.id as string, aggregate: aggregate.id as string };
}

type ResultSet = Awaited<ReturnType<typeof resultSet>>;
async function publish(result: ResultSet, classId: string | null = result.classId, user = USERS.ownerA as string) {
  const [publication] = await rows(user,
    `INSERT INTO result_publications (school_id, term_id, class_id, published_by_user_id, status, is_published, published_at)
     VALUES ($1, $2, $3, $4, 'published', true, now()) RETURNING id`, [result.school, result.term, classId, user]);
  return publication.id as string;
}

async function expectResults(user: string, result: ResultSet, count: number) {
  for (const [table, id] of [["student_assessment_marks", result.mark], ["student_term_aggregates", result.aggregate]]) {
    const direct = await rows(user, `SELECT id FROM ${table} WHERE id = $1`, [id]);
    assert.equal(direct.length, count, `${user}: ${table}`);
    const list = await rows(user, `SELECT id FROM ${table}`);
    assert.equal(list.some((row) => row.id === id), count === 1, `${user}: ${table} list`);
  }
}

describe("result publication RLS", () => {
  it("hides marks and aggregates until their actual term/class is published; staff/teachers retain reads", async () => {
    const result = await resultSet();
    for (const user of [USERS.ownerA, USERS.adminA, USERS.teacherA]) await expectResults(user, result, 1);
    for (const user of family) await expectResults(user, result, 0);
    const [draft] = await rows(USERS.ownerA,
      `INSERT INTO result_publications (school_id, term_id, class_id, published_by_user_id)
       VALUES ($1, $2, $3, $4) RETURNING id`, [fx.schoolA, result.term, fx.class1, USERS.ownerA]);
    await publish(await resultSet()); // An unrelated published assessment must not unlock this one.
    await publish(result, fx.class2); // Nor may publication of another class in the same term.
    for (const user of family) await expectResults(user, result, 0);
    await rows(USERS.ownerA,
      "UPDATE result_publications SET status = 'published', is_published = true, published_at = now() WHERE id = $1", [draft.id]);
    for (const user of family) await expectResults(user, result, 1);
    for (const user of [USERS.ownerB, USERS.teacherA2, USERS.outsider]) await expectResults(user, result, 0);
    const [otherMark] = await rows(USERS.teacherA,
      "INSERT INTO student_assessment_marks (school_id, assessment_id, student_id, marks_obtained) VALUES ($1, $2, $3, 12) RETURNING id",
      [fx.schoolA, result.assessment, extraStudent]);
    const [otherAggregate] = await rows(USERS.ownerA,
      `INSERT INTO student_term_aggregates (school_id, student_id, term_id, class_id, subject)
       VALUES ($1, $2, $3, $4, 'Mathematics') RETURNING id`, [fx.schoolA, extraStudent, result.term, fx.class1]);
    for (const user of family) await expectResults(user, { ...result, mark: otherMark.id, aggregate: otherAggregate.id }, 0);
    await expectResults(USERS.teacherA, { ...result, mark: otherMark.id, aggregate: otherAggregate.id }, 1);
  });

  it("supports school-wide publication and hides family reads again after retraction", async () => {
    const result = await resultSet();
    const publication = await publish(result, null);
    for (const user of family) await expectResults(user, result, 1);
    await rows(USERS.ownerA,
      "UPDATE result_publications SET status = 'draft', is_published = false, published_at = NULL WHERE id = $1", [publication]);
    for (const user of family) await expectResults(user, result, 0);
    await expectResults(USERS.teacherA, result, 1);
  });

  it("does not expose other-school results or marks with mismatched assessment school references", async () => {
    const foreign = await resultSet(USERS.ownerB, fx.schoolB, fx.yearB, fx.classB, fx.studentB);
    await publish(foreign, null, USERS.ownerB);
    for (const user of [...family, USERS.ownerA, USERS.teacherA]) await expectResults(user, foreign, 0);
    const local = await resultSet();
    await publish(local);
    // Existing write policies permit these inconsistent legacy references. Read hardening must fail closed.
    await rows(USERS.teacherA,
      "UPDATE student_assessment_marks SET school_id = $2 WHERE id = $1", [local.mark, fx.schoolB]);
    for (const user of family) {
      assert.deepEqual(await rows(user, "SELECT id FROM student_assessment_marks WHERE id = $1", [local.mark]), []);
    }
    // Use an assessment in B with the linked student in A to exercise actual assessment school/publication.
    const [linkedMark] = await rows(USERS.ownerB,
      "INSERT INTO student_assessment_marks (school_id, assessment_id, student_id) VALUES ($1, $2, $3) RETURNING id",
      [fx.schoolB, foreign.assessment, fx.student1]);
    const [aggregate] = await rows(USERS.ownerB,
      `INSERT INTO student_term_aggregates (school_id, student_id, term_id, class_id, subject)
       VALUES ($1, $2, $3, $4, 'Foreign reference') RETURNING id`, [fx.schoolB, fx.student1, local.term, fx.class1]);
    for (const user of family) await expectResults(user, { ...foreign, mark: linkedMark.id, aggregate: aggregate.id }, 0);
  });
});
