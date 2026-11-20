// Teacher Digital Classroom: real upload → confirm → lifecycle → submission → marking,
// exercised through HTTP with the in-memory storage adapter standing in for Supabase.
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
import { MAX_FILE_BYTES, createMemoryStorage, markUploaded } from "../src/lib/storage";
import { asUser, startTestDatabase, type TestDatabase } from "./support/database";
import { buildFixture, USERS, type Fixture } from "./support/fixture";

type TargetFile = {
  id: string; path: string; name: string; size: number; type: string;
  extension: string; kind: string; method: string; uploadUrl: string;
  headers: Record<string, string>; expiresAt: string;
};
type DeclaredFile = Pick<TargetFile, "id" | "path" | "name" | "size" | "type">;

let db: TestDatabase;
let api: pg.Pool;
let fx: Fixture;
let server: Server;
let baseUrl: string;
let classMate: string;
const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const project = "digital-classroom-test";
const storage = createMemoryStorage();

async function rows(user: string | null, text: string, values: unknown[] = []) {
  return asUser(api, user, async (client) => (await client.query(text, values)).rows);
}

async function request(user: string | null, method: string, path: string, body?: unknown, school = fx.schoolA) {
  const headers: Record<string, string> = { "x-school-id": school };
  if (user) {
    const handle = user.replace("user_", "");
    headers.authorization = `Bearer ${await new SignJWT({
      auth_time: Math.floor(Date.now() / 1000) - 30,
      name: handle,
      email: `${handle.toLowerCase()}@example.test`,
      email_verified: true,
    }).setProtectedHeader({ alg: "RS256", kid: "local-test" })
      .setSubject(user).setIssuer(`https://securetoken.google.com/${project}`)
      .setAudience(project).setIssuedAt().setExpirationTime("2m").sign(keys.privateKey)}`;
  }
  const response = await fetch(`${baseUrl}/api/v1${path}`, {
    method,
    headers: { ...headers, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({})) as Record<string, never>;
  return { status: response.status, json: json as any };
}

function expectHttp(result: Awaited<ReturnType<typeof request>>, status: number, code?: string) {
  assert.equal(result.status, status, JSON.stringify(result.json));
  if (code) assert.equal(result.json.error?.code, code);
}

function isoDay(offsetDays: number) {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

function isoTime(offsetMs: number) {
  return new Date(Date.now() + offsetMs).toISOString();
}

/** Mints upload targets; the caller decides which of them really reach storage. */
async function upload(user: string, path: string, files: Array<{ name: string; size: number; type: string }>,
  classId = fx.class1) {
  const result = await request(user, "POST", path, { classId, files });
  expectHttp(result, 201);
  return result.json.data as TargetFile[];
}

/** Simulates the browser's PUT landing in storage, then declares the file to the API. */
async function stored(targets: DeclaredFile[], size = 2048): Promise<DeclaredFile[]> {
  for (const target of targets) markUploaded(storage, target.path, size, target.type);
  return targets.map((target) => ({ ...target, size }));
}

async function material(user = USERS.teacherA as string) {
  const targets = await upload(user, "/learning/upload-targets",
    [{ name: "Notes on Fractions.pdf", size: 2048, type: "application/pdf" }]);
  const created = await request(user, "POST", "/learning/resources", {
    classId: fx.class1,
    title: `Fractions notes ${randomUUID().slice(0, 8)}`,
    description: "Worked examples for the whole class.",
    resourceType: "pdf",
    category: "class_notes",
    subject: "Mathematics",
    files: await stored(targets),
  });
  expectHttp(created, 201);
  return { id: created.json.id as string, path: targets[0].path };
}

async function assignment(user = USERS.teacherA as string, overrides: Record<string, unknown> = {}) {
  const created = await request(user, "POST", "/assignments", {
    classId: fx.class1,
    subject: "Mathematics",
    title: `Homework ${randomUUID().slice(0, 8)}`,
    instructions: [{ type: "text", content: "Answer every question in the booklet." }],
    marksAllocated: 20,
    deadlineDate: isoDay(7),
    deadlineTime: "18:00:00",
    assignmentKind: "homework",
    topic: "Fractions",
    publish: "published",
    ...overrides,
  });
  expectHttp(created, 201, undefined);
  return created.json.id as string;
}

/** Notifications are recipient-only under RLS, so the schema owner reads them for assertions. */
async function recipients(type: string, entityId: string) {
  const result = await db.owner.query(
    "SELECT auth_user_id FROM notifications WHERE type = $1 AND entity_id = $2 ORDER BY auth_user_id",
    [type, entityId]);
  return result.rows.map((row) => row.auth_user_id);
}

before(async () => {
  db = await startTestDatabase();
  api = new pg.Pool({ connectionString: db.apiUrl, max: 6 });
  fx = await buildFixture(api);
  const [mate] = await rows(USERS.ownerA,
    `INSERT INTO students (school_id, class_id, first_name, last_name, admission_number)
     VALUES ($1, $2, 'Neighbour', 'Classmate', 'A-009') RETURNING id`, [fx.schoolA, fx.class1]);
  classMate = mate.id;
  const config = loadConfig({ NODE_ENV: "test", PORT: "1", DATABASE_URL: db.apiUrl,
    FIREBASE_PROJECT_ID: project, CORS_ALLOWED_ORIGINS: "http://localhost:5173" });
  const identity = firebaseIdentityVerifier(project, createLocalJWKSet({
    keys: [{ ...keys.publicKey.export({ format: "jwk" }), kid: "local-test", alg: "RS256", use: "sig" }],
  }));
  server = createApp({ config, identity, database: createDatabase(api), logger: pino({ level: "silent" }), storage })
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

describe("material uploads and lifecycle", () => {
  it("mints upload targets only for the classes the caller may teach", async () => {
    const targets = await upload(USERS.teacherA, "/learning/upload-targets",
      [{ name: "Revision.pptx", size: 4096, type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }]);
    const [target] = targets;
    assert.equal(target.method, "PUT");
    assert.equal(target.kind, "powerpoint");
    assert.equal(target.extension, "pptx");
    assert.deepEqual(Object.keys(target.headers), ["content-type"]);
    assert.match(target.path, new RegExp(`^${fx.schoolA}/${fx.class1}/resources/[0-9a-f-]{36}/revision\\.pptx$`));

    expectHttp(await request(USERS.ownerA, "POST", "/learning/upload-targets",
      { classId: fx.classB, files: [{ name: "a.pdf", size: 10, type: "application/pdf" }] }), 404);
    expectHttp(await request(USERS.teacherA2, "POST", "/learning/upload-targets",
      { classId: fx.class1, files: [{ name: "a.pdf", size: 10, type: "application/pdf" }] }), 404);
    expectHttp(await request(USERS.bursarA, "POST", "/learning/upload-targets",
      { classId: fx.class1, files: [{ name: "a.pdf", size: 10, type: "application/pdf" }] }), 403);
    expectHttp(await request(USERS.studentA, "POST", "/learning/upload-targets",
      { classId: fx.class1, files: [{ name: "a.pdf", size: 10, type: "application/pdf" }] }), 403);
  });

  it("rejects unsupported, empty and oversized files before any URL is issued", async () => {
    const cases: Array<[string, { name: string; size: number; type: string }]> = [
      ["unsupported_file_type", { name: "notes.exe", size: 100, type: "application/octet-stream" }],
      ["validation_failed", { name: "notes.pdf", size: 0, type: "application/pdf" }],
      ["file_too_large", { name: "notes.pdf", size: MAX_FILE_BYTES + 1, type: "application/pdf" }],
      ["unsupported_file_type", { name: "notes.pdf", size: 10, type: "text/plain" }],
    ];
    for (const [code, file] of cases) {
      expectHttp(await request(USERS.teacherA, "POST", "/learning/upload-targets", { classId: fx.class1, files: [file] }),
        400, code);
    }
    expectHttp(await request(USERS.teacherA, "POST", "/learning/upload-targets", {
      classId: fx.class1,
      files: Array.from({ length: 11 }, (_, index) => ({ name: `note-${index}.pdf`, size: 10, type: "application/pdf" })),
    }), 400, "validation_failed");
  });

  it("refuses to record a file that never reached storage or belongs to another class", async () => {
    const [pending] = await upload(USERS.teacherA, "/learning/upload-targets",
      [{ name: "handout.pdf", size: 2048, type: "application/pdf" }]);
    const title = `Never uploaded ${randomUUID().slice(0, 8)}`;
    expectHttp(await request(USERS.teacherA, "POST", "/learning/resources", {
      classId: fx.class1, title, resourceType: "pdf",
      files: [{ id: pending.id, path: pending.path, name: pending.name, size: 2048, type: pending.type }],
    }), 400, "upload_incomplete");
    assert.deepEqual(await rows(USERS.ownerA, "SELECT id FROM learning_resources WHERE title = $1", [title]), []);

    const forged = {
      id: randomUUID(),
      path: `${fx.schoolA}/${fx.class2}/resources/${randomUUID()}/handout.pdf`,
      name: "handout.pdf", size: 2048, type: "application/pdf",
    };
    markUploaded(storage, forged.path, 2048, "application/pdf");
    expectHttp(await request(USERS.teacherA, "POST", "/learning/resources", {
      classId: fx.class1, title: `Forged ${randomUUID().slice(0, 8)}`, resourceType: "pdf", files: [forged],
    }), 400, "invalid_file_path");
  });

  it("keeps drafts private, then publishes real files to the enrolled learner", async () => {
    const { id, path: originalPath } = await material();
    const learnerList = () => request(USERS.studentA, "GET", `/learning/resources?classId=${fx.class1}`);
    const draft = await request(USERS.teacherA, "GET", `/learning/resources/management?classId=${fx.class1}`);
    expectHttp(draft, 200);
    const managed = draft.json.data.find((row: { id: string }) => row.id === id);
    assert.equal(managed.state, "draft");
    assert.equal(managed.files[0].size, 2048);
    assert.equal((await learnerList()).json.data.some((row: { id: string }) => row.id === id), false);
    expectHttp(await request(USERS.studentA, "GET", `/learning/resources/${id}`), 404);
    expectHttp(await request(USERS.studentA, "GET", `/learning/resources/${id}/download`), 404);

    expectHttp(await request(USERS.teacherA2, "POST", `/learning/resources/${id}/publish`, { state: "published" }), 404);
    const published = await request(USERS.teacherA, "POST", `/learning/resources/${id}/publish`, { state: "published" });
    expectHttp(published, 200);
    assert.equal(published.json.state, "published");
    assert.deepEqual(await recipients("resource.published", id), [USERS.parentA, USERS.studentA].sort());

    assert.equal((await learnerList()).json.data.some((row: { id: string }) => row.id === id), true);
    const detail = await request(USERS.studentA, "GET", `/learning/resources/${id}`);
    expectHttp(detail, 200);
    assert.equal(detail.json.category, "class_notes");
    assert.equal(detail.json.files.length, 1);

    const fileId = detail.json.files[0].id as string;
    const download = await request(USERS.studentA, "GET", `/learning/resources/${id}/files/${fileId}/download`);
    expectHttp(download, 200);
    assert.match(download.json.url, /^memory:\/\/download\//);
    assert.equal(download.json.size, 2048);
    const preview = await request(USERS.studentA, "GET", `/learning/resources/${id}/files/${fileId}/preview`);
    expectHttp(preview, 200);
    assert.match(preview.json.url, /^memory:\/\/preview\//);
    const [logs] = await rows(USERS.ownerA,
      `SELECT count(*)::int AS downloads FROM resource_access_logs
       WHERE resource_id = $1 AND student_id = $2 AND was_downloaded`, [id, fx.student1]);
    assert.equal(logs.downloads, 1);

    // Editing after publication replaces the attachment set and drops the orphaned object.
    const replacement = await upload(USERS.teacherA, "/learning/upload-targets",
      [{ name: "updated.pdf", size: 3072, type: "application/pdf" }]);
    const edited = await request(USERS.teacherA, "PATCH", `/learning/resources/${id}`, {
      title: "Fractions notes, corrected", files: await stored(replacement, 3072),
    });
    expectHttp(edited, 200);
    assert.equal(edited.json.files.length, 1);
    assert.equal(edited.json.files[0].size, 3072);
    assert.equal(storage.objects.has(replacement[0].path), true);
    assert.equal(storage.objects.has(originalPath), false);
    expectHttp(await request(USERS.studentA, "GET", `/learning/resources/${id}/files/${fileId}/download`), 404);

    expectHttp(await request(USERS.studentA, "DELETE", `/learning/resources/${id}`), 403);
    expectHttp(await request(USERS.teacherA, "DELETE", `/learning/resources/${id}`), 204);
    assert.equal((await learnerList()).json.data.some((row: { id: string }) => row.id === id), false);
    const archived = await request(USERS.teacherA, "GET", `/learning/resources/management?classId=${fx.class1}&state=archived`);
    expectHttp(archived, 200);
    assert.equal(archived.json.data.some((row: { id: string }) => row.id === id), true);
  });

  it("schedules a future publication that learners cannot open early", async () => {
    const { id } = await material();
    const scheduled = await request(USERS.teacherA, "POST", `/learning/resources/${id}/publish`,
      { state: "scheduled", publishAt: isoTime(3_600_000) });
    expectHttp(scheduled, 200);
    assert.equal(scheduled.json.state, "scheduled");
    assert.equal((await request(USERS.studentA, "GET", `/learning/resources/${id}`)).status, 404);
    expectHttp(await request(USERS.teacherA, "POST", `/learning/resources/${id}/publish`,
      { state: "scheduled", publishAt: isoTime(-60_000) }), 400, "schedule_in_past");

    const back = await request(USERS.teacherA, "POST", `/learning/resources/${id}/publish`, { state: "draft" });
    expectHttp(back, 200);
    assert.equal(back.json.state, "draft");
    assert.equal(back.json.isVisibleToStudents, false);
  });

  it("lists only the subjects that exist in the teacher's classroom", async () => {
    const teacher = await request(USERS.teacherA, "GET", `/learning/subject-options?classId=${fx.class1}`);
    expectHttp(teacher, 200);
    assert.equal(teacher.json.data.includes("Mathematics"), true);
    const unassigned = await request(USERS.teacherA2, "GET", `/learning/subject-options?classId=${fx.class1}`);
    expectHttp(unassigned, 200);
    assert.deepEqual(unassigned.json.data, []);
  });
});

describe("assignment lifecycle, submissions and marking", () => {
  it("hides drafts from learners and their guardians", async () => {
    const id = await assignment(USERS.teacherA, { publish: "draft" });
    const learner = await request(USERS.studentA, "GET", "/assignments");
    expectHttp(learner, 200);
    assert.equal(learner.json.data.some((row: { id: string }) => row.id === id), false);
    // Guardians have no assignment endpoint yet; the parent portal says so instead of guessing.
    expectHttp(await request(USERS.parentA, "GET", `/assignments/${id}`), 400, "not_a_student");
    expectHttp(await request(USERS.studentA, "POST", `/assignments/${id}/submit`, { submissionText: "Early" }), 404);

    const managed = await request(USERS.teacherA, "GET", `/assignments/management?classId=${fx.class1}&state=draft`);
    expectHttp(managed, 200);
    assert.equal(managed.json.data.some((row: { id: string }) => row.id === id), true);
    expectHttp(await request(USERS.studentA, "GET", `/assignments/management?classId=${fx.class1}`), 403);
  });

  it("publishing notifies the class and opens submissions", async () => {
    const id = await assignment(USERS.teacherA, { publish: "draft" });
    assert.deepEqual(await recipients("assignment.published", id), []);
    const published = await request(USERS.teacherA, "POST", `/assignments/${id}/publish`, { state: "published" });
    expectHttp(published, 200);
    assert.equal(published.json.state, "published");
    assert.deepEqual(await recipients("assignment.published", id), [USERS.parentA, USERS.studentA].sort());

    const learner = await request(USERS.studentA, "GET", "/assignments");
    const row = learner.json.data.find((item: { id: string }) => item.id === id);
    assert.equal(row.status, "not_started");
    assert.equal(row.topic, undefined);
    const detail = await request(USERS.studentA, "GET", `/assignments/${id}`);
    expectHttp(detail, 200);
    assert.equal(detail.json.topic, "Fractions");
    assert.equal(detail.json.assignmentKind, "homework");
    assert.equal(detail.json.state, "published");
    assert.deepEqual(detail.json.instructions, [{ type: "text", content: "Answer every question in the booklet." }]);
  });

  it("saves text and file submissions only once storage confirms them", async () => {
    const id = await assignment(USERS.teacherA, { allowResubmission: true, allowedFileTypes: ["pdf"] });
    expectHttp(await request(USERS.studentA, "POST", `/assignments/${id}/submit`, {}), 400, "empty_submission");

    const [target] = await upload(USERS.studentA, `/assignments/${id}/submission/upload-targets`,
      [{ name: "answer.pdf", size: 1536, type: "application/pdf" }]);
    assert.match(target.path, new RegExp(`^${fx.schoolA}/${fx.class1}/submissions/`));
    expectHttp(await request(USERS.studentA, "POST", `/assignments/${id}/submission/upload-targets`,
      { files: [{ name: "answer.docx", size: 512, type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }] }),
      400, "unsupported_file_type");

    const declared = [{ id: target.id, path: target.path, name: target.name, size: 1536, type: target.type }];
    expectHttp(await request(USERS.studentA, "POST", `/assignments/${id}/submit`, { files: declared }),
      400, "upload_incomplete");
    markUploaded(storage, target.path, 9_000, "application/pdf");

    const first = await request(USERS.studentA, "POST", `/assignments/${id}/submit`, {
      submissionText: "Attempt one", files: declared,
    });
    expectHttp(first, 201);
    assert.equal(first.json.status, "submitted");
    assert.equal(first.json.isLate, false);

    const saved = await rows(USERS.studentA,
      "SELECT submitted_files, submission_text FROM assignment_submissions WHERE assignment_id = $1", [id]);
    // Storage decides the size: the browser claimed 1536 bytes.
    assert.equal(saved[0].submitted_files[0].size, 9_000);

    const [revision] = await rows(USERS.studentA,
      "UPDATE assignment_submissions SET submitted_at = now() - interval '1 hour' WHERE assignment_id = $1 RETURNING id", [id]);
    const second = await request(USERS.studentA, "POST", `/assignments/${id}/submit`, { submissionText: "Attempt two" });
    expectHttp(second, 201);
    const [history] = await rows(USERS.studentA,
      "SELECT revision_history FROM assignment_submissions WHERE id = $1", [revision.id]);
    assert.equal(history.revision_history.length, 1);
    assert.equal(history.revision_history[0].text, "Attempt one");

    const teacherView = await request(USERS.teacherA, "GET", `/assignments/${id}/submissions`);
    expectHttp(teacherView, 200);
    const mine = teacherView.json.data.find((row: { studentId: string }) => row.studentId === fx.student1);
    assert.equal(mine.submittedFiles[0].name, "answer.pdf");
    assert.equal(teacherView.json.submissionCount, 1);
    assert.equal(teacherView.json.notSubmittedCount, 1);
    assert.equal(teacherView.json.gradedCount, 0);

    const fileUrl = await request(USERS.teacherA,
      "GET", `/assignments/${id}/submissions/${mine.id}/files/${declared[0].id}/download`);
    expectHttp(fileUrl, 200);
    assert.match(fileUrl.json.url, /^memory:\/\/download\//);
    expectHttp(await request(USERS.teacherA2, "GET", `/assignments/${id}/submissions`), 404);
  });

  it("applies late rules, maximum marks and release of feedback", async () => {
    const closed = await assignment(USERS.teacherA, { deadlineDate: isoDay(-1) });
    expectHttp(await request(USERS.studentA, "POST", `/assignments/${closed}/submit`, { submissionText: "Late" }),
      400, "deadline_exceeded");

    const open = await assignment(USERS.teacherA, { deadlineDate: isoDay(-1), allowLate: true });
    const late = await request(USERS.studentA, "POST", `/assignments/${open}/submit`, { submissionText: "Late but allowed" });
    expectHttp(late, 201);
    assert.equal(late.json.isLate, true);

    expectHttp(await request(USERS.teacherA2, "POST", `/assignments/${open}/submissions/${late.json.id}/mark`,
      { marksObtained: 5 }), 404);
    expectHttp(await request(USERS.studentA, "POST", `/assignments/${open}/submissions/${late.json.id}/mark`,
      { marksObtained: 5 }), 403);
    expectHttp(await request(USERS.teacherA, "POST", `/assignments/${open}/submissions/${late.json.id}/mark`,
      { marksObtained: 21 }), 400, "marks_exceeded");
    const marked = await request(USERS.teacherA, "POST", `/assignments/${open}/submissions/${late.json.id}/mark`,
      { marksObtained: 17, feedback: "Clear method, check the last line." });
    expectHttp(marked, 200);
    assert.deepEqual(await recipients("submission.graded", open), [USERS.parentA, USERS.studentA].sort());

    const learnerView = await request(USERS.studentA, "GET", `/assignments/${open}/submission`);
    expectHttp(learnerView, 200);
    assert.equal(learnerView.json.marksObtained, 17);
    assert.equal(learnerView.json.status, "graded");
    for (const method of ["POST", "PUT"] as const) {
      expectHttp(await request(USERS.studentA, method, `/assignments/${open}/submit`, { submissionText: "Tampered" }),
        400, "submission_graded");
    }
    const filtered = await request(USERS.teacherA, "GET", `/assignments/${open}/submissions?filter=late&search=Wanjiru`);
    expectHttp(filtered, 200);
    assert.equal(filtered.json.total, 1);
    assert.equal(filtered.json.data[0].admissionNumber, "A-001");
    const none = await request(USERS.teacherA, "GET", `/assignments/${open}/submissions?search=Neighbour&filter=pending`);
    expectHttp(none, 200);
    assert.equal(none.json.total, 0);
  });

  it("duplicates without sharing files, extends deadlines only forwards, and archives", async () => {
    const id = await assignment(USERS.teacherA, { topic: "Algebra", allowLate: true });
    const duplicate = await request(USERS.teacherA, "POST", `/assignments/${id}/duplicate`);
    expectHttp(duplicate, 201);
    assert.equal(duplicate.json.state, "draft");
    assert.equal(duplicate.json.title.endsWith("(copy)"), true);
    assert.deepEqual(duplicate.json.files, []);
    assert.notEqual(duplicate.json.id, id);

    expectHttp(await request(USERS.teacherA, "POST", `/assignments/${id}/extend-deadline`,
      { deadlineDate: isoDay(1) }), 400, "deadline_not_extended");
    const extended = await request(USERS.teacherA, "POST", `/assignments/${id}/extend-deadline`,
      { deadlineDate: isoDay(30), deadlineTime: "20:00:00" });
    expectHttp(extended, 200);
    assert.equal(extended.json.deadlineDate, isoDay(30));
    assert.deepEqual(await recipients("assignment.deadline", id), [USERS.parentA, USERS.studentA].sort());

    const archived = await request(USERS.teacherA, "POST", `/assignments/${id}/state`, { state: "archived" });
    expectHttp(archived, 200);
    assert.equal(archived.json.state, "archived");
    const learner = await request(USERS.studentA, "GET", "/assignments");
    assert.equal(learner.json.data.some((row: { id: string }) => row.id === id), false);
    expectHttp(await request(USERS.studentA, "POST", `/assignments/${id}/submit`, { submissionText: "After archive" }), 404);
  });

  it("keeps another school's classroom out of reach", async () => {
    const id = await assignment(USERS.teacherA);
    // RLS resolves the assignment in the caller's school, so Baraka finds nothing at all.
    assert.deepEqual(await rows(USERS.ownerB, "SELECT id FROM assignments WHERE id = $1", [id]), []);
    expectHttp(await request(USERS.ownerB, "GET", `/assignments/${id}/submissions`, undefined, fx.schoolB), 404);
    expectHttp(await request(USERS.ownerB, "POST", `/assignments/${id}/publish`, { state: "published" }, fx.schoolB), 404);
    expectHttp(await request(USERS.ownerB, "GET", `/assignments/management?classId=${fx.class1}`, undefined, fx.schoolB), 404);
    expectHttp(await request(USERS.ownerB, "POST", "/learning/upload-targets",
      { classId: fx.class1, files: [{ name: "a.pdf", size: 10, type: "application/pdf" }] }, fx.schoolB), 404);
    // Same school, unassigned teacher: the class is not theirs.
    expectHttp(await request(USERS.teacherA2, "GET", `/assignments/management?classId=${fx.class1}`), 404);
    expectHttp(await request(USERS.outsider, "GET", `/assignments/${id}/submissions`), 403);
    expectHttp(await request(null, "GET", `/assignments/${id}/submissions`), 401);
  });
});
