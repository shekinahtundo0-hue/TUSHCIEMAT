import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import type pg from "pg";
import pino from "pino";
import { createApp } from "../src/app";
import { loadConfig } from "../src/config/env";
import { createDatabase, createPool, type Database } from "../src/lib/database";
import { unauthorized } from "../src/lib/errors";
import type { IdentityVerifier, VerifiedIdentity, VerifiedProfile } from "../src/lib/identity";
import { asUser, startTestDatabase, type TestDatabase } from "./support/database";
import { USERS, buildFixture, hashToken, newToken, syncProfile, type Fixture } from "./support/fixture";

let db: TestDatabase;
let database: Database;
let api: pg.Pool;
let server: Server;
let baseUrl: string;
let fx: Fixture;
let initialDiscovery: boolean[];
let sequence = 0;

// Only this isolated createApp instance trusts these opaque fixture sessions. No
// Firebase network calls, request-body identity claims, or database RLS bypasses.
const sessions = new Map<string, VerifiedIdentity>();
const accountTokens = new Map<string, string>();
const identity: IdentityVerifier = {
  async verify(token) {
    const verified = sessions.get(token);
    if (!verified) throw unauthorized();
    return verified;
  },
};

type RequestedRole = "student" | "teacher" | "school_admin" | "parent";
type Options = { as?: string; school?: string; body?: unknown; token?: string };

function register(user: string, profile: Partial<VerifiedProfile> = {}): string {
  const token = newToken();
  sessions.set(token, {
    userId: user,
    profile: {
      fullName: user.replace("user_", ""),
      email: `${user.replace("user_", "").toLowerCase()}@example.test`,
      imageUrl: null,
      ...profile,
    },
  });
  accountTokens.set(user, token);
  return user;
}

function account(profile: Partial<VerifiedProfile> = {}): string {
  return register(`user_membership_${++sequence}`, profile);
}

async function call(method: string, path: string, options: Options = {}) {
  const headers: Record<string, string> = {};
  const token = options.token ?? (options.as ? accountTokens.get(options.as) : undefined);
  if (token) headers.authorization = `Bearer ${token}`;
  if (options.school) headers["x-school-id"] = options.school;
  if (options.body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(`${baseUrl}/api/v1${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json: any = text ? JSON.parse(text) : null;
  return { status: response.status, json, headers: response.headers };
}

type Result = Awaited<ReturnType<typeof call>>;

function ok(result: Result, status = 200) {
  assert.equal(result.status, status, JSON.stringify(result.json));
  return result.json;
}

function error(result: Result, statuses: number | number[]) {
  assert.ok(
    (Array.isArray(statuses) ? statuses : [statuses]).includes(result.status),
    `unexpected status ${result.status}: ${JSON.stringify(result.json)}`,
  );
  assert.equal(typeof result.json?.error?.code, "string");
  assert.equal(typeof result.json?.error?.message, "string");
  assert.ok(result.json?.error?.requestId);
}

async function rows(user: string | null, text: string, values: unknown[] = []) {
  return asUser(api, user, async (client) => (await client.query(text, values)).rows);
}

async function denied(promise: Promise<unknown>, codes: string[] = ["42501"]) {
  await assert.rejects(promise, (cause: Error & { code?: string }) => {
    assert.ok(codes.includes(cause.code ?? ""), `${cause.code}: ${cause.message}`);
    return true;
  });
}

async function submit(
  user: string,
  role: RequestedRole = "teacher",
  details: Record<string, string> = {},
  school = fx.schoolA,
) {
  return ok(await call("POST", `/schools/${school}/join-requests`, {
    as: user,
    body: { requestedRole: role, fullName: "Fixture Applicant", ...details },
  }), 201);
}

async function review(
  requestId: string,
  body: Record<string, unknown> = { decision: "approved" },
  user: string = USERS.adminA,
  school = fx.schoolA,
) {
  return call("POST", `/join-requests/${requestId}/review`, { as: user, school, body });
}

async function pending(user: string, requestId: string) {
  const mine = ok(await call("GET", "/join-requests/mine", { as: user }));
  const request = mine.find((item: { id: string }) => item.id === requestId);
  assert.ok(request);
  assert.equal(request.status, "pending");
  assert.equal(request.reviewedAt, null);
  assert.equal(request.studentId, null);
  assert.equal(request.guardianId, null);
  assert.deepEqual(await rows(user, "SELECT id FROM school_memberships WHERE school_id = $1", [fx.schoolA]), []);
}

async function learner(status = "active", school = fx.schoolA, classId = fx.class2) {
  const owner = school === fx.schoolA ? USERS.ownerA : USERS.ownerB;
  const [student] = await rows(owner,
    `INSERT INTO students (school_id, class_id, first_name, last_name, admission_number, status)
     VALUES ($1, $2, 'Fixture', 'Learner', $3, $4) RETURNING id`,
    [school, classId, `MEM-${++sequence}`, status]);
  return student.id as string;
}

async function guardian(email: string | null, childId?: string, school = fx.schoolA) {
  const owner = school === fx.schoolA ? USERS.ownerA : USERS.ownerB;
  return asUser(api, owner, async (client) => {
    const [record] = (await client.query(
      "INSERT INTO guardians (school_id, full_name, email) VALUES ($1, 'Fixture Guardian', $2) RETURNING id",
      [school, email],
    )).rows;
    if (childId) {
      await client.query(
        `INSERT INTO student_guardians (school_id, student_id, guardian_id, relationship)
         VALUES ($1, $2, $3, 'guardian')`, [school, childId, record.id]);
    }
    return record.id as string;
  });
}

function emailOf(user: string): string {
  const email = sessions.get(accountTokens.get(user)!)?.profile.email;
  assert.ok(email);
  return email;
}

async function invite(user: string, role: RequestedRole = "teacher", inviter: string = USERS.adminA) {
  const created = await call("POST", "/invitations", {
    as: inviter, school: fx.schoolA, body: { email: emailOf(user), role },
  });
  const result = ok(created, 201);
  assert.equal(created.headers.get("cache-control"), "no-store");
  assert.match(result.acceptPath, /^\/accept-invite#[A-Za-z0-9_-]{43}$/);
  return { id: result.invitation.id as string, token: result.acceptPath.split("#")[1] as string };
}

function accept(user: string, token: string, school = fx.schoolA, role: RequestedRole = "teacher") {
  return call("POST", `/schools/${school}/join-with-invitation`, { as: user, body: { token, role } });
}

function settings(overrides: Record<string, unknown> = {}) {
  return {
    name: "Amani Secondary", category: "secondary", curriculum: "CBC", country: "Kenya",
    county: "Nairobi", town: "Westlands", logoUrl: "https://example.test/logo.png",
    description: "A public school description", contactEmail: "office@example.test",
    contactPhone: "+254 700 123456", website: "https://example.test/", discoverable: true,
    ...overrides,
  };
}

const DIRECTORY_KEYS = [
  "id", "name", "category", "country", "county", "town", "logoUrl", "description", "verificationStatus",
].sort();

before(async () => {
  db = await startTestDatabase();
  const config = loadConfig({
    NODE_ENV: "test", PORT: "1", DATABASE_URL: db.apiUrl,
    FIREBASE_PROJECT_ID: "tushciemat-membership-test", CORS_ALLOWED_ORIGINS: "http://localhost:5173",
  });
  api = createPool({ connectionString: db.apiUrl, max: 8, caCert: null });
  database = createDatabase(api);
  fx = await buildFixture(api);
  for (const user of Object.values(USERS)) register(user);
  initialDiscovery = [
    (await rows(USERS.ownerA, "SELECT discoverable FROM schools WHERE id = $1", [fx.schoolA]))[0].discoverable,
    (await rows(USERS.ownerB, "SELECT discoverable FROM schools WHERE id = $1", [fx.schoolB]))[0].discoverable,
  ];
  // Existing schools opt in through their actual owner identity, not an RLS exception.
  await rows(USERS.ownerA, "UPDATE schools SET discoverable = true WHERE id = $1", [fx.schoolA]);
  await rows(USERS.ownerB, "UPDATE schools SET discoverable = true WHERE id = $1", [fx.schoolB]);
  server = createApp({ config, database, identity, logger: pino({ level: "silent" }) }).listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server ? server.close(() => resolve()) : resolve());
  await api?.end();
  await db?.stop();
});

describe("school discovery and creation", () => {
  it("existing schools default to hidden; directory projection does not grant tenant access", async () => {
    assert.deepEqual(initialDiscovery, [false, false]);
    const list = ok(await call("GET", "/schools/discover?search=amani&page=1", { as: USERS.outsider }));
    assert.deepEqual(list.map((item: { id: string }) => item.id), [fx.schoolA]);
    assert.deepEqual(Object.keys(list[0]).sort(), DIRECTORY_KEYS);
    assert.deepEqual(await rows(USERS.outsider, "SELECT id FROM schools"), []);
    assert.deepEqual(await rows(USERS.outsider, "SELECT id FROM students"), []);
  });

  it("supports empty search and bounds stable directory pages to 20 public records", async () => {
    await asUser(api, USERS.ownerA, async (client) => {
      for (let i = 0; i < 23; i++) {
        const [school] = (await client.query(
          `INSERT INTO schools (name, slug, category, curriculum, created_by_user_id, discoverable)
           VALUES ($1, $2, 'secondary', 'CBC', $3, true) RETURNING id`,
          [`Pagination School ${String(i).padStart(2, "0")}`, `pagination-${i}`, USERS.ownerA],
        )).rows;
        await client.query("INSERT INTO school_memberships (school_id, auth_user_id, role) VALUES ($1, $2, 'owner')",
          [school.id, USERS.ownerA]);
      }
    });
    const empty = ok(await call("GET", "/schools/discover?search=&page=1", { as: USERS.outsider }));
    assert.equal(empty.length, 20);
    const first = ok(await call("GET", "/schools/discover?search=Pagination&page=1", { as: USERS.outsider }));
    const second = ok(await call("GET", "/schools/discover?search=Pagination&page=2", { as: USERS.outsider }));
    assert.equal(first.length, 20);
    assert.equal(second.length, 3);
    const ids = [...first, ...second].map((item: { id: string }) => item.id);
    assert.equal(new Set(ids).size, 23);
    assert.deepEqual(ok(await call("GET", "/schools/discover?search=Pagination&page=1", { as: USERS.outsider })), first);
    for (const item of [...empty, ...first, ...second]) assert.deepEqual(Object.keys(item).sort(), DIRECTORY_KEYS);
  });

  it("treats search wildcards and SQL-like input as data, and rejects invalid paging", async () => {
    for (const search of ["%_", "' OR 1=1 --", "no-such-institution"]) {
      assert.deepEqual(ok(await call("GET", `/schools/discover?search=${encodeURIComponent(search)}`, { as: USERS.outsider })), []);
    }
    for (const query of ["page=0", "page=-1", "page=1.5", "page=102", "page=no", `search=${"x".repeat(161)}`]) {
      error(await call("GET", `/schools/discover?${query}`, { as: USERS.outsider }), 400);
    }
  });

  it("returns selected-school metadata only and hides non-discoverable and unknown schools", async () => {
    const detail = ok(await call("GET", `/schools/discover/${fx.schoolA}`, { as: USERS.outsider }));
    assert.equal(detail.id, fx.schoolA);
    assert.deepEqual(Object.keys(detail).sort(), DIRECTORY_KEYS);
    const hidden = ok(await call("POST", "/schools", {
      as: USERS.outsider,
      body: { name: "Hidden Institution", category: "primary", curriculum: "CBC",
        academicYear: { name: "2026", startsOn: "2026-01-05", endsOn: "2026-11-27" } },
    }), 201);
    assert.equal(hidden.discoverable, false);
    error(await call("GET", `/schools/discover/${hidden.id}`, { as: USERS.ownerB }), 404);
    error(await call("GET", `/schools/discover/${randomUUID()}`, { as: USERS.outsider }), 404);
    error(await call("GET", "/schools/discover/not-a-uuid", { as: USERS.outsider }), 400);
  });

  it("creates an opted-in school with metadata and never accepts frontend verification", async () => {
    const user = account();
    const body = { ...settings({ name: "New Metadata Institution" }),
      academicYear: { name: "2026", startsOn: "2026-01-05", endsOn: "2026-11-27" } };
    error(await call("POST", "/schools", { as: user, body: { ...body, verificationStatus: "verified" } }), 400);
    const created = ok(await call("POST", "/schools", { as: user, body }), 201);
    for (const key of ["country", "town", "description", "logoUrl", "contactEmail", "contactPhone", "website", "discoverable"] as const) {
      assert.equal(created[key], body[key]);
    }
    assert.equal(created.verificationStatus, "unverified");
    assert.equal(ok(await call("GET", `/schools/discover/${created.id}`, { as: USERS.ownerB })).verificationStatus, "unverified");
    assert.deepEqual(ok(await call("GET", "/me", { as: user })).schools[0].roles, ["owner"]);
  });
});

describe("request submission and pending isolation", () => {
  it("requires an authenticated account with verified email even when a body claims an email", async () => {
    error(await call("POST", `/schools/${fx.schoolA}/join-requests`, {
      body: { requestedRole: "teacher", fullName: "Anonymous Applicant" },
    }), 401);
    const unverified = account({ email: null });
    error(await call("POST", `/schools/${fx.schoolA}/join-requests`, {
      as: unverified, body: { requestedRole: "teacher", fullName: "Unverified Applicant" },
    }), 403);
    error(await call("POST", `/schools/${fx.schoolA}/join-requests`, {
      as: unverified, body: { requestedRole: "teacher", fullName: "Unverified Applicant", email: "forged@example.test" },
    }), 400);
    assert.deepEqual(ok(await call("GET", "/join-requests/mine", { as: unverified })), []);
  });

  it("stores role-specific details and verified identity but pending grants zero school access", async () => {
    const user = account({ fullName: "Verified Name", email: "pending@example.test" });
    const request = await submit(user, "teacher", {
      fullName: "Applicant Display Name", staffNumber: "STAFF-101", department: "Sciences",
      subjects: "Physics, Chemistry", classes: "Form 1 East",
    });
    assert.equal(request.authUserId, user);
    assert.equal(request.applicantEmail, "pending@example.test");
    assert.equal(request.applicantName, "Applicant Display Name");
    assert.equal(request.applicantDetails.department, "Sciences");
    assert.equal(request.applicantDetails.classes, "Form 1 East");
    await pending(user, request.id);
    assert.deepEqual(ok(await call("GET", "/me", { as: user })).schools, []);
    for (const path of ["/dashboard", "/students", "/classes", "/members", "/announcements", "/school-settings"]) {
      error(await call("GET", path, { as: user, school: fx.schoolA }), 403);
    }
    for (const table of ["schools", "students", "school_classes", "guardians", "class_teacher_assignments", "announcements"]) {
      assert.deepEqual(await rows(user, `SELECT id FROM ${table}`), [], table);
    }
  });

  it("enforces one pending request per school/account/role while preserving other roles and schools", async () => {
    const user = account();
    const first = await submit(user);
    error(await call("POST", `/schools/${fx.schoolA}/join-requests`, {
      as: user, body: { requestedRole: "teacher", fullName: "Duplicate Applicant" },
    }), 409);
    const parent = await submit(user, "parent", { relationship: "mother", admissionNumber: "A-001" });
    const other = await submit(user, "teacher", {}, fx.schoolB);
    const mine = ok(await call("GET", "/join-requests/mine", { as: user }));
    assert.deepEqual(new Set(mine.map((item: { id: string }) => item.id)), new Set([first.id, parent.id, other.id]));
  });

  it("isolates my requests and manager queues from other applicants and schools", async () => {
    const user = account();
    const other = account();
    const own = await submit(user);
    const foreign = await submit(other, "teacher", {}, fx.schoolB);
    const mine = ok(await call("GET", "/join-requests/mine", { as: user, school: fx.schoolB }));
    assert.deepEqual(mine.map((item: { id: string }) => item.id), [own.id]);
    const queue = ok(await call("GET", "/join-requests", { as: USERS.adminA, school: fx.schoolA }));
    assert.ok(queue.some((item: { id: string }) => item.id === own.id));
    assert.ok(queue.every((item: { schoolId: string; id: string }) => item.schoolId === fx.schoolA && item.id !== foreign.id));
    error(await call("GET", "/join-requests", { as: USERS.adminA }), 400);
    for (const caller of [user, USERS.teacherA, USERS.bursarA, USERS.parentA, USERS.studentA, USERS.ownerB]) {
      error(await call("GET", "/join-requests", { as: caller, school: fx.schoolA }), 403);
    }
    assert.deepEqual((await rows(user, "SELECT id FROM school_join_requests")).map((item) => item.id), [own.id]);
    assert.ok((await rows(USERS.ownerB, "SELECT school_id FROM school_join_requests")).every((item) => item.school_id === fx.schoolB));
  });

  it("rejects unsupported privileged roles, malformed fields, and caller-supplied authority", async () => {
    const user = account();
    for (const body of [
      { requestedRole: "owner", fullName: "Applicant" },
      { requestedRole: "platform_admin", fullName: "Applicant" },
      { requestedRole: "bursar", fullName: "Applicant" },
      { requestedRole: "teacher", fullName: "" },
      { requestedRole: "teacher", fullName: "Applicant", department: "x".repeat(161) },
      { requestedRole: "teacher", fullName: "Applicant", status: "approved", authUserId: USERS.ownerA },
    ]) {
      error(await call("POST", `/schools/${fx.schoolA}/join-requests`, { as: user, body }), 400);
    }
    error(await call("POST", `/schools/${randomUUID()}/join-requests`, {
      as: user, body: { requestedRole: "teacher", fullName: "Applicant" },
    }), 404);
    assert.deepEqual(ok(await call("GET", "/join-requests/mine", { as: user })), []);
  });

  it("cannot regain a suspended same-role membership by submitting a request", async () => {
    const user = account();
    await syncProfile(api, user, emailOf(user));
    await rows(USERS.ownerA,
      "INSERT INTO school_memberships (school_id, auth_user_id, role, status) VALUES ($1, $2, 'teacher', 'suspended')",
      [fx.schoolA, user]);
    error(await call("POST", `/schools/${fx.schoolA}/join-requests`, {
      as: user, body: { requestedRole: "teacher", fullName: "Suspended Teacher" },
    }), 403);
    error(await call("GET", "/classes", { as: user, school: fx.schoolA }), 403);
    assert.deepEqual(ok(await call("GET", "/join-requests/mine", { as: user })), []);
    assert.equal((await rows(user, "SELECT status FROM school_memberships WHERE school_id = $1", [fx.schoolA]))[0].status, "suspended");
  });
});

describe("manager decisions and student account linking", () => {
  it("requires a same-school manager and cannot review through a forged school context", async () => {
    const user = account();
    const request = await submit(user);
    for (const caller of [user, USERS.teacherA, USERS.bursarA, USERS.parentA, USERS.studentA, USERS.ownerB]) {
      error(await review(request.id, { decision: "approved" }, caller), 403);
    }
    error(await review(request.id, { decision: "approved" }, USERS.ownerB, fx.schoolB), 404);
    error(await call("POST", `/join-requests/${request.id}/review`, { as: USERS.adminA, body: { decision: "approved" } }), 400);
    await pending(user, request.id);
  });

  it("forbids self-review even when the applicant already has manager authority", async () => {
    const request = await submit(USERS.ownerA, "school_admin", { position: "Administrator", reason: "Additional role" });
    error(await review(request.id, { decision: "approved" }, USERS.ownerA), 403);
    assert.equal(ok(await call("GET", "/join-requests/mine", { as: USERS.ownerA })).find((item: { id: string }) => item.id === request.id).status, "pending");
    assert.deepEqual(ok(await call("GET", "/me", { as: USERS.ownerA })).schools.find((item: { schoolId: string }) => item.schoolId === fx.schoolA).roles, ["owner"]);
  });

  it("requires a rejection reason of at least three non-whitespace characters, then leaves access absent", async () => {
    const user = account();
    const request = await submit(user);
    for (const reason of [undefined, null, "ab", "   ", " a "]) {
      error(await review(request.id, { decision: "rejected", ...(reason === undefined ? {} : { reason }) }), 400);
    }
    const rejected = ok(await review(request.id, { decision: "rejected", reason: " Not on staff register " }));
    assert.equal(rejected.status, "rejected");
    assert.equal(rejected.rejectionReason, "Not on staff register");
    assert.equal(rejected.reviewedByUserId, USERS.adminA);
    assert.ok(rejected.reviewedAt);
    assert.deepEqual(ok(await call("GET", "/me", { as: user })).schools, []);
    const notifications = ok(await call("GET", "/notifications", { as: user }));
    const notice = notifications.find((item: { entityId: string }) => item.entityId === request.id);
    assert.ok(notice);
    assert.ok(notice.body.includes("Not on staff register"));
    error(await review(request.id), [404, 409]);
    assert.equal(ok(await call("GET", "/join-requests/mine", { as: user }))[0].status, "rejected");
  });

  it("never uses a claimed admission number to auto-link an existing student", async () => {
    const user = account();
    const request = await submit(user, "student", { admissionNumber: "A-002", programme: "CBC", academicYear: "2026" });
    error(await review(request.id), 400);
    await pending(user, request.id);
    assert.equal((await rows(USERS.ownerA, "SELECT auth_user_id FROM students WHERE id = $1", [fx.student2]))[0].auth_user_id, null);
    const selected = await learner();
    const approved = ok(await review(request.id, { decision: "approved", studentId: selected }));
    assert.equal(approved.studentId, selected);
    assert.equal(approved.status, "approved");
    assert.equal(ok(await call("GET", "/portal/learner", { as: user, school: fx.schoolA })).studentId, selected);
    assert.deepEqual((await rows(user, "SELECT id FROM students")).map((item) => item.id), [selected]);
    assert.equal((await rows(USERS.ownerA, "SELECT auth_user_id FROM students WHERE id = $1", [fx.student2]))[0].auth_user_id, null);
  });

  it("student approval rejects cross-school, inactive, missing, and already-linked records atomically", async () => {
    const user = account();
    const request = await submit(user, "student", { admissionNumber: "A-001" });
    const inactive = await learner("inactive");
    for (const studentId of [fx.studentB, fx.student1, inactive, randomUUID()]) {
      error(await review(request.id, { decision: "approved", studentId }), 400);
      await pending(user, request.id);
    }
    assert.equal((await rows(USERS.ownerA, "SELECT auth_user_id FROM students WHERE id = $1", [fx.student1]))[0].auth_user_id, USERS.studentA);
    assert.deepEqual(ok(await call("GET", "/notifications", { as: user })), []);
  });

  it("approves a teacher without trusting claimed classes or assigning classroom access", async () => {
    const user = account();
    const request = await submit(user, "teacher", { staffNumber: "T-200", subjects: "Mathematics", classes: "Form 1 East, Form 1 West" });
    const approved = ok(await review(request.id));
    assert.equal(approved.status, "approved");
    assert.equal(approved.studentId, null);
    assert.equal(approved.guardianId, null);
    assert.deepEqual(ok(await call("GET", "/me", { as: user })).schools, [
      { schoolId: fx.schoolA, schoolName: "Amani Secondary", roles: ["teacher"], capabilities: [] },
    ]);
    assert.deepEqual(ok(await call("GET", "/classes", { as: user, school: fx.schoolA })), []);
    assert.deepEqual(ok(await call("GET", "/students", { as: user, school: fx.schoolA })).items, []);
    assert.deepEqual(await rows(user, "SELECT id FROM class_teacher_assignments"), []);
    error(await call("GET", "/members", { as: user, school: fx.schoolA }), 403);
    error(await review(request.id, { decision: "rejected", reason: "Second decision" }), [404, 409]);
  });

  it("adds school_admin without owner/platform escalation and preserves an existing role", async () => {
    const request = await submit(USERS.teacherA2, "school_admin", { position: "Registrar", reason: "School appointment" });
    ok(await review(request.id));
    const me = ok(await call("GET", "/me", { as: USERS.teacherA2 }));
    assert.deepEqual(new Set(me.schools.find((item: { schoolId: string }) => item.schoolId === fx.schoolA).roles), new Set(["teacher", "school_admin"]));
    assert.equal(me.platformRole, null);
    error(await call("GET", "/platform/schools", { as: USERS.teacherA2 }), 403);
    error(await call("POST", "/invitations", {
      as: USERS.teacherA2, school: fx.schoolA, body: { email: "owner-escalation@example.test", role: "owner" },
    }), 403);
    const owner = (await rows(USERS.ownerA, "SELECT id FROM school_memberships WHERE school_id = $1 AND role = 'owner'", [fx.schoolA]))[0];
    error(await call("PATCH", `/members/${owner.id}`, { as: USERS.teacherA2, school: fx.schoolA, body: { status: "suspended" } }), 403);
  });

  it("cannot approve a pending request after a same-role membership has been suspended", async () => {
    const user = account();
    const request = await submit(user);
    await rows(USERS.ownerA,
      "INSERT INTO school_memberships (school_id, auth_user_id, role, status) VALUES ($1, $2, 'teacher', 'suspended')",
      [fx.schoolA, user]);
    error(await review(request.id), 403);
    const mine = ok(await call("GET", "/join-requests/mine", { as: user }));
    assert.equal(mine[0].status, "pending");
    assert.equal((await rows(user, "SELECT status FROM school_memberships WHERE school_id = $1", [fx.schoolA]))[0].status, "suspended");
    assert.deepEqual(ok(await call("GET", "/notifications", { as: user })), []);
    error(await call("GET", "/classes", { as: user, school: fx.schoolA }), 403);
  });

  it("concurrent opposing reviews result in exactly one immutable decision and notification", async () => {
    const user = account();
    const request = await submit(user);
    const results = await Promise.all([
      review(request.id, { decision: "approved" }, USERS.adminA),
      review(request.id, { decision: "rejected", reason: "Not appointed" }, USERS.ownerA),
    ]);
    assert.equal(results.filter((result) => result.status === 200).length, 1);
    for (const result of results.filter((result) => result.status !== 200)) error(result, [404, 409]);
    const winner = results.find((result) => result.status === 200)!.json;
    const final = ok(await call("GET", "/join-requests/mine", { as: user }))[0];
    assert.equal(final.status, winner.status);
    assert.equal(final.reviewedByUserId, winner.reviewedByUserId);
    const memberships = await rows(user, "SELECT role FROM school_memberships WHERE school_id = $1", [fx.schoolA]);
    assert.equal(memberships.length, final.status === "approved" ? 1 : 0);
    const notifications = ok(await call("GET", "/notifications", { as: user }));
    assert.equal(notifications.filter((item: { entityId: string }) => item.entityId === request.id).length, 1);
    error(await review(request.id), [404, 409]);
  });

  it("refuses approval after the applicant loses their verified email or the email changes", async () => {
    for (const newEmail of [null, "changed@example.test"]) {
      const user = account();
      const request = await submit(user);
      register(user, { email: newEmail });
      ok(await call("GET", "/me", { as: user }));
      error(await review(request.id), 403);
      await pending(user, request.id);
    }
  });
});

describe("parent approval requires school-held child relationships", () => {
  it("links an explicit same-school guardian with matching verified email and an existing child", async () => {
    const user = account();
    const child = await learner("active", fx.schoolA, fx.class1);
    const guardianId = await guardian(emailOf(user), child);
    const request = await submit(user, "parent", { relationship: "guardian", admissionNumber: "A-002" });
    const approved = ok(await review(request.id, { decision: "approved", guardianId }));
    assert.equal(approved.guardianId, guardianId);
    assert.equal(approved.studentId, null);
    assert.deepEqual(ok(await call("GET", "/portal/children", { as: user, school: fx.schoolA })).map((item: { studentId: string }) => item.studentId), [child]);
    assert.deepEqual((await rows(user, "SELECT id FROM students")).map((item) => item.id), [child]);
    assert.equal(ok(await call("GET", "/portal/children", { as: user, school: fx.schoolA }))[0].className, "Form 1 East");
    error(await call("GET", "/classes", { as: user, school: fx.schoolA }), 403);
    error(await call("GET", "/students", { as: user, school: fx.schoolA }), 403);
  });

  it("cannot approve a parent with only a claimed admission number or a guardian without a child", async () => {
    const user = account();
    const request = await submit(user, "parent", { admissionNumber: "A-001", relationship: "mother" });
    error(await review(request.id), 400);
    const guardianId = await guardian(emailOf(user));
    error(await review(request.id, { decision: "approved", guardianId }), 400);
    await pending(user, request.id);
    assert.equal((await rows(USERS.ownerA, "SELECT auth_user_id FROM guardians WHERE id = $1", [guardianId]))[0].auth_user_id, null);
  });

  it("rejects cross-school, email-mismatched, and already-linked guardians without changing child links", async () => {
    const user = account();
    const request = await submit(user, "parent", { relationship: "father", admissionNumber: "A-001" });
    const crossSchool = await guardian(emailOf(user), fx.studentB, fx.schoolB);
    const mismatched = await guardian("different-parent@example.test", fx.student2);
    for (const guardianId of [crossSchool, mismatched, fx.guardian1, randomUUID()]) {
      error(await review(request.id, { decision: "approved", guardianId }), 400);
      await pending(user, request.id);
    }
    assert.equal((await rows(USERS.ownerA, "SELECT auth_user_id FROM guardians WHERE id = $1", [fx.guardian1]))[0].auth_user_id, USERS.parentA);
    assert.deepEqual((await rows(USERS.parentA, "SELECT id FROM students")).map((item) => item.id), [fx.student1]);
  });

  it("does not transfer an already-linked guardian even when another verified account has the same email", async () => {
    const user = account({ email: "parenta@example.test" });
    const request = await submit(user, "parent", { relationship: "mother" });
    error(await review(request.id, { decision: "approved", guardianId: fx.guardian1 }), 400);
    await pending(user, request.id);
    assert.equal((await rows(USERS.ownerA, "SELECT auth_user_id FROM guardians WHERE id = $1", [fx.guardian1]))[0].auth_user_id, USERS.parentA);
    assert.deepEqual(await rows(user, "SELECT id FROM students"), []);
  });
});

describe("school settings, profiles and safe people projections", () => {
  it("allows manager metadata updates and exposes only the public projection to discovery", async () => {
    const updated = ok(await call("PATCH", "/school-settings", { as: USERS.adminA, school: fx.schoolA, body: settings() }));
    assert.equal(updated.country, "Kenya");
    assert.equal(updated.town, "Westlands");
    assert.equal(updated.contactEmail, "office@example.test");
    assert.equal(updated.verificationStatus, "unverified");
    assert.equal(ok(await call("GET", "/school-settings", { as: USERS.ownerA, school: fx.schoolA })).description, "A public school description");
    const publicDetail = ok(await call("GET", `/schools/discover/${fx.schoolA}`, { as: USERS.ownerB }));
    assert.deepEqual(Object.keys(publicDetail).sort(), DIRECTORY_KEYS);
    assert.equal(publicDetail.description, updated.description);
  });

  it("blocks nonmanagers and cross-school settings access and cannot self-verify through API or SQL", async () => {
    for (const user of [USERS.teacherA, USERS.bursarA, USERS.parentA, USERS.studentA, USERS.ownerB]) {
      error(await call("GET", "/school-settings", { as: user, school: fx.schoolA }), 403);
      error(await call("PATCH", "/school-settings", { as: user, school: fx.schoolA, body: settings({ description: "Unauthorized" }) }), 403);
    }
    error(await call("PATCH", "/school-settings", { as: USERS.adminA, school: fx.schoolA, body: settings({ verificationStatus: "verified" }) }), 400);
    await denied(rows(USERS.ownerA, "UPDATE schools SET verification_status = 'verified' WHERE id = $1", [fx.schoolA]));
    assert.equal(ok(await call("GET", "/school-settings", { as: USERS.ownerA, school: fx.schoolA })).verificationStatus, "unverified");
  });

  it("denies a suspended creator permanent read or update authority", async () => {
    const user = account();
    const created = ok(await call("POST", "/schools", {
      as: user,
      body: {
        name: "Former Creator School",
        category: "secondary",
        curriculum: "CBC",
        academicYear: { name: "2026", startsOn: "2026-01-05", endsOn: "2026-11-27" },
      },
    }), 201);
    // The last active owner cannot be suspended, even by a database operator.
    await assert.rejects(
      db.owner.query(
        "UPDATE school_memberships SET status = 'suspended' WHERE school_id = $1 AND auth_user_id = $2",
        [created.id, user],
      ),
      /last active owner/,
    );
    const successor = account();
    await syncProfile(api, successor, emailOf(successor));
    await rows(user, "INSERT INTO school_memberships (school_id, auth_user_id, role) VALUES ($1, $2, 'owner')", [created.id, successor]);
    await db.owner.query(
      "UPDATE school_memberships SET status = 'suspended' WHERE school_id = $1 AND auth_user_id = $2",
      [created.id, user],
    );

    assert.deepEqual(await rows(user, "SELECT id FROM schools WHERE id = $1", [created.id]), []);
    assert.deepEqual(await rows(user, "UPDATE schools SET name = 'Unauthorized' WHERE id = $1 RETURNING id", [created.id]), []);
    error(await call("GET", "/school-settings", { as: user, school: created.id }), 403);
  });

  it("disabling discovery hides both listing/detail and prevents new requests", async () => {
    ok(await call("PATCH", "/school-settings", { as: USERS.ownerA, school: fx.schoolA, body: settings({ discoverable: false }) }));
    try {
      assert.deepEqual(ok(await call("GET", "/schools/discover?search=Amani", { as: USERS.ownerB })), []);
      error(await call("GET", `/schools/discover/${fx.schoolA}`, { as: USERS.ownerB }), 404);
      error(await call("POST", `/schools/${fx.schoolA}/join-requests`, {
        as: account(), body: { requestedRole: "teacher", fullName: "Applicant" },
      }), 404);
    } finally {
      ok(await call("PATCH", "/school-settings", { as: USERS.ownerA, school: fx.schoolA, body: settings() }));
    }
  });

  it("full profiles remain own-only while manager rosters use a school-scoped three-column projection", async () => {
    for (const user of [USERS.ownerA, USERS.adminA, USERS.teacherA, USERS.parentA, USERS.studentA]) {
      assert.deepEqual((await rows(user, "SELECT auth_user_id FROM user_profiles")).map((item) => item.auth_user_id), [user]);
      assert.deepEqual(await rows(user, "SELECT email FROM user_profiles WHERE auth_user_id = $1", [USERS.ownerB]), []);
    }
    const people = await rows(USERS.adminA, "SELECT * FROM app_private.school_people($1)", [fx.schoolA]);
    assert.ok(people.some((item) => item.auth_user_id === USERS.teacherA && item.full_name === "teacherA"));
    assert.ok(people.every((item) => item.auth_user_id !== USERS.ownerB));
    for (const person of people) assert.deepEqual(Object.keys(person).sort(), ["auth_user_id", "email", "full_name"]);
    const roster = ok(await call("GET", "/members", { as: USERS.adminA, school: fx.schoolA }));
    assert.equal(roster.find((item: { authUserId: string }) => item.authUserId === USERS.teacherA).fullName, "teacherA");
    assert.ok(roster.every((item: { authUserId: string }) => item.authUserId !== USERS.ownerB));
    for (const user of [USERS.ownerB, USERS.outsider, USERS.parentA, USERS.studentA]) {
      await denied(rows(user, "SELECT * FROM app_private.school_people($1)", [fx.schoolA]));
    }
  });

  it("teacher peer names are class-scoped and redact other teachers' emails", async () => {
    const peer = account({ fullName: "Visible Peer Teacher" });
    await syncProfile(api, peer, emailOf(peer));
    await rows(peer, "SELECT app_private.sync_user_profile($1, 'Visible Peer Teacher', $2, NULL)", [peer, emailOf(peer)]);
    await rows(USERS.ownerA, "INSERT INTO school_memberships (school_id, auth_user_id, role) VALUES ($1, $2, 'teacher')", [fx.schoolA, peer]);
    await rows(USERS.ownerA,
      `INSERT INTO class_teacher_assignments (school_id, class_id, teacher_user_id, assignment_role, subject, created_by_user_id)
       VALUES ($1, $2, $3, 'subject_teacher', 'Physics', $4)`, [fx.schoolA, fx.class1, peer, USERS.ownerA]);
    const people = await rows(USERS.teacherA, "SELECT * FROM app_private.school_people($1)", [fx.schoolA]);
    const visible = people.find((item) => item.auth_user_id === peer);
    assert.equal(visible?.full_name, "Visible Peer Teacher");
    assert.equal(visible?.email, null);
    assert.ok(people.every((item) => [USERS.teacherA, peer].includes(item.auth_user_id)));
    const classes = ok(await call("GET", "/classes", { as: USERS.teacherA, school: fx.schoolA }));
    assert.deepEqual(classes.map((item: { id: string }) => item.id), [fx.class1]);
    assert.deepEqual(classes[0].teachers.map((item: { teacherUserId: string }) => item.teacherUserId), [USERS.teacherA]);
    assert.equal(classes[0].teachers[0].teacherName, "teacherA");
    const managedClasses = ok(await call("GET", "/classes", { as: USERS.adminA, school: fx.schoolA }));
    assert.equal(managedClasses.find((item: { id: string }) => item.id === fx.class1).teachers.find((item: { teacherUserId: string }) => item.teacherUserId === peer).teacherName, "Visible Peer Teacher");
  });

  it("parents and students see linked class names through their portals, not staff class management", async () => {
    for (const user of [USERS.parentA, USERS.studentA]) {
      assert.deepEqual((await rows(user, "SELECT id FROM school_classes")).map((item) => item.id), [fx.class1]);
      assert.deepEqual(await rows(user, "SELECT id FROM school_classes WHERE id IN ($1, $2)", [fx.class2, fx.classB]), []);
      const portal = ok(await call("GET", user === USERS.parentA ? "/portal/children" : "/portal/learner", { as: user, school: fx.schoolA }));
      assert.equal((user === USERS.parentA ? portal[0] : portal).className, "Form 1 East");
      error(await call("GET", "/classes", { as: user, school: fx.schoolA }), 403);
      error(await call("GET", "/classes", { as: user, school: fx.schoolB }), 403);
    }
  });
});

describe("account notifications and school announcements", () => {
  it("pending/rejected applicants need no active school to read and mark their own notifications", async () => {
    const user = account();
    const request = await submit(user);
    assert.deepEqual(ok(await call("GET", "/notifications", { as: user })), []);
    ok(await review(request.id, { decision: "rejected", reason: "Please contact the office" }));
    const notifications = ok(await call("GET", "/notifications", { as: user }));
    const notice = notifications.find((item: { entityId: string }) => item.entityId === request.id);
    assert.ok(notice);
    assert.equal(notice.readAt, null);
    const read = ok(await call("POST", `/notifications/${notice.id}/read`, { as: user }));
    assert.ok(read.readAt);
    assert.equal(read.id, notice.id);
    const repeat = ok(await call("POST", `/notifications/${notice.id}/read`, { as: user }));
    assert.equal(repeat.readAt, read.readAt);
    assert.deepEqual(ok(await call("GET", "/me", { as: user })).schools, []);
  });

  it("cannot list or mark another account's notification through HTTP or direct API-role SQL", async () => {
    const user = account();
    const other = account();
    const request = await submit(user);
    ok(await review(request.id, { decision: "rejected", reason: "No matching record" }));
    const notice = ok(await call("GET", "/notifications", { as: user }))[0];
    assert.deepEqual(ok(await call("GET", "/notifications", { as: other })), []);
    for (const attacker of [other, USERS.ownerA, USERS.ownerB]) {
      error(await call("POST", `/notifications/${notice.id}/read`, { as: attacker, school: fx.schoolA }), 404);
      assert.deepEqual(await rows(attacker, "SELECT id FROM notifications WHERE id = $1", [notice.id]), []);
      assert.deepEqual(await rows(attacker, "UPDATE notifications SET read_at = now() WHERE id = $1 RETURNING id", [notice.id]), []);
    }
    assert.equal(ok(await call("GET", "/notifications", { as: user }))[0].readAt, null);
    await denied(rows(user, "UPDATE notifications SET body = 'Forged' WHERE id = $1", [notice.id]));
    error(await call("GET", "/notifications"), 401);
  });

  it("publishes to active school accounts only and deduplicates multi-role recipients", async () => {
    const suspended = account();
    await syncProfile(api, suspended, emailOf(suspended));
    await rows(USERS.ownerA,
      "INSERT INTO school_memberships (school_id, auth_user_id, role, status) VALUES ($1, $2, 'teacher', 'suspended')", [fx.schoolA, suspended]);
    const applicant = account();
    await submit(applicant);
    const announcement = ok(await call("POST", "/announcements", {
      as: USERS.adminA, school: fx.schoolA, body: { title: "School assembly", body: "Assembly starts at 08:00." },
    }), 201);
    assert.equal(announcement.schoolId, fx.schoolA);
    assert.equal(announcement.authorUserId, USERS.adminA);
    const active = await rows(USERS.ownerA,
      "SELECT DISTINCT auth_user_id FROM school_memberships WHERE school_id = $1 AND status = 'active'", [fx.schoolA]);
    for (const { auth_user_id: user } of active) {
      const notices = await rows(user, "SELECT id, title FROM notifications WHERE entity_id = $1", [announcement.id]);
      assert.equal(notices.length, 1, `one announcement per account, including multi-role account ${user}`);
      assert.equal(notices[0].title, "School assembly");
    }
    for (const user of [suspended, applicant, USERS.ownerB]) {
      assert.deepEqual(await rows(user, "SELECT id FROM notifications WHERE entity_id = $1", [announcement.id]), []);
      error(await call("GET", "/announcements", { as: user, school: fx.schoolA }), 403);
    }
    const list = ok(await call("GET", "/announcements", { as: USERS.parentA, school: fx.schoolA }));
    assert.ok(list.some((item: { id: string }) => item.id === announcement.id));
    assert.deepEqual(await rows(USERS.ownerB, "SELECT id FROM announcements WHERE id = $1", [announcement.id]), []);
    assert.ok(ok(await call("GET", "/announcements", { as: USERS.ownerB, school: fx.schoolB })).every((item: { schoolId: string }) => item.schoolId === fx.schoolB));
  });

  it("restricts publishing to managers and rejects invalid or forged authorship", async () => {
    for (const user of [USERS.teacherA, USERS.bursarA, USERS.parentA, USERS.studentA, USERS.ownerB]) {
      error(await call("POST", "/announcements", { as: user, school: fx.schoolA, body: { title: "Forged", body: "Message" } }), 403);
      await denied(rows(user, "SELECT * FROM app_private.publish_announcement($1, 'Forged', 'Message')", [fx.schoolA]));
    }
    for (const body of [{ title: "", body: "Message" }, { title: "Valid", body: "" }, { title: "Valid", body: "Message", authorUserId: USERS.ownerB }]) {
      error(await call("POST", "/announcements", { as: USERS.adminA, school: fx.schoolA, body }), 400);
    }
    error(await call("GET", "/announcements", { as: USERS.adminA }), 400);
  });
});

describe("selected-school invitation acceptance", () => {
  it("checks school and role before consuming a hash-only invitation and accepts it once", async () => {
    const user = account();
    const invitation = await invite(user);
    const [stored] = await rows(USERS.adminA, "SELECT token_hash, status FROM invitations WHERE id = $1", [invitation.id]);
    assert.equal(stored.token_hash, hashToken(invitation.token));
    assert.notEqual(stored.token_hash, invitation.token);
    error(await accept(user, invitation.token, fx.schoolB), 404);
    error(await accept(user, invitation.token, fx.schoolA, "school_admin"), 404);
    assert.equal((await rows(USERS.adminA, "SELECT status FROM invitations WHERE id = $1", [invitation.id]))[0].status, "pending");
    assert.deepEqual(ok(await call("GET", "/me", { as: user })).schools, []);
    assert.deepEqual(ok(await accept(user, invitation.token)), { schoolId: fx.schoolA, role: "teacher" });
    error(await accept(user, invitation.token), 404);
    assert.equal((await rows(USERS.adminA, "SELECT status FROM invitations WHERE id = $1", [invitation.id]))[0].status, "accepted");
    const list = ok(await call("GET", "/invitations", { as: USERS.adminA, school: fx.schoolA }));
    assert.ok(!JSON.stringify(list).includes(invitation.token));
    assert.ok(!JSON.stringify(list).includes(hashToken(invitation.token)));
  });

  it("does not consume tokens for wrong or unverified email, and blocks malformed/unknown tokens", async () => {
    const user = account();
    const invitation = await invite(user);
    error(await accept(account(), invitation.token), 403);
    error(await accept(account({ email: null }), invitation.token), 403);
    error(await accept(user, "short"), 400);
    error(await accept(user, `${"x".repeat(42)}!`), 400);
    error(await accept(user, newToken()), 404);
    assert.equal((await rows(USERS.adminA, "SELECT status FROM invitations WHERE id = $1", [invitation.id]))[0].status, "pending");
    ok(await accept(user, invitation.token));
  });

  it("cannot accept expired or revoked selected-school invitations", async () => {
    const expiredUser = account();
    const token = newToken();
    await rows(USERS.adminA,
      `INSERT INTO invitations (school_id, email, role, token_hash, invited_by_user_id, expires_at)
       VALUES ($1, $2, 'teacher', $3, $4, now() - interval '1 minute')`,
      [fx.schoolA, emailOf(expiredUser), hashToken(token), USERS.adminA]);
    error(await accept(expiredUser, token), 404);
    const user = account();
    const invitation = await invite(user);
    ok(await call("POST", `/invitations/${invitation.id}/revoke`, { as: USERS.adminA, school: fx.schoolA }));
    error(await accept(user, invitation.token), 404);
    assert.deepEqual(ok(await call("GET", "/me", { as: expiredUser })).schools, []);
    assert.deepEqual(ok(await call("GET", "/me", { as: user })).schools, []);
  });

  it("accepts a selected-school invitation exactly once under concurrent HTTP attempts", async () => {
    const user = account();
    const invitation = await invite(user);
    const results = await Promise.all([accept(user, invitation.token), accept(user, invitation.token), accept(user, invitation.token)]);
    assert.equal(results.filter((result) => result.status === 200).length, 1);
    for (const result of results.filter((result) => result.status !== 200)) error(result, 404);
    assert.equal((await rows(user, "SELECT id FROM school_memberships WHERE school_id = $1 AND role = 'teacher'", [fx.schoolA])).length, 1);
  });

  it("both acceptance routes reject a now-suspended inviter's managerial authority without consumption", async () => {
    const manager = account();
    await syncProfile(api, manager, emailOf(manager));
    const [managerMembership] = await rows(USERS.ownerA,
      "INSERT INTO school_memberships (school_id, auth_user_id, role) VALUES ($1, $2, 'school_admin') RETURNING id", [fx.schoolA, manager]);
    // New co-administrators start with zero capabilities; the owner delegates explicitly.
    await rows(USERS.ownerA, "SELECT app_private.set_member_capabilities($1, $2, ARRAY['people.manage']::text[])",
      [fx.schoolA, managerMembership.id]);
    const user = account();
    const invitation = await invite(user, "teacher", manager);
    const [membership] = await rows(USERS.ownerA,
      "UPDATE school_memberships SET status = 'suspended' WHERE school_id = $1 AND auth_user_id = $2 RETURNING id", [fx.schoolA, manager]);
    assert.ok(membership);
    error(await call("POST", "/invitations/accept", { as: user, body: { token: invitation.token } }), 403);
    error(await accept(user, invitation.token), 403);
    assert.equal((await rows(USERS.adminA, "SELECT status FROM invitations WHERE id = $1", [invitation.id]))[0].status, "pending");
    assert.deepEqual(ok(await call("GET", "/me", { as: user })).schools, []);
  });
});

describe("trusted routines through the actual least-privilege API pool", () => {
  it("uses the non-owner API login with a transaction-local current UID and no bypass", async () => {
    const [role] = await rows(USERS.ownerA,
      `SELECT current_user AS name, app_private.current_user_id() AS uid, rolsuper, rolbypassrls
       FROM pg_roles WHERE rolname = current_user`);
    assert.deepEqual(role, { name: "tushciemat_api", uid: USERS.ownerA, rolsuper: false, rolbypassrls: false });
    assert.equal((await rows(null, "SELECT app_private.current_user_id() AS uid"))[0].uid, null);
    for (const table of ["school_join_requests", "notifications", "announcements", "user_profiles"]) {
      assert.deepEqual(await rows(null, `SELECT id FROM ${table}`), [], table);
    }
  });

  it("directory SQL returns only safe metadata and cannot be used to read hidden tenant data", async () => {
    const directory = await rows(USERS.outsider, "SELECT * FROM app_private.school_directory($1, $2, $3)", ["amani", null, 0]);
    assert.equal(directory.length, 1);
    assert.equal(directory[0].id, fx.schoolA);
    assert.deepEqual(Object.keys(directory[0]).sort(), ["id", "name", "category", "country", "county", "town", "logo_url", "description", "verification_status"].sort());
    assert.deepEqual(await rows(USERS.outsider, "SELECT id FROM students"), []);
    await denied(rows(null, "SELECT * FROM app_private.school_directory($1, $2, $3)", ["amani", null, 0]));
  });

  it("cannot forge pending requests, approve directly, or insert notifications/announcements", async () => {
    const user = account();
    const request = await submit(user);
    await denied(rows(user,
      `INSERT INTO school_join_requests (school_id, auth_user_id, requested_role, school_name, applicant_name, applicant_email, applicant_details)
       VALUES ($1, $2, 'school_admin', 'Forged', 'Forged Applicant', $3, '{}'::jsonb)`, [fx.schoolA, user, emailOf(user)]));
    await denied(rows(USERS.adminA, "UPDATE school_join_requests SET status = 'approved' WHERE id = $1", [request.id]));
    await denied(rows(user,
      "INSERT INTO notifications (school_id, auth_user_id, type, title, body) VALUES ($1, $2, 'request.approved', 'Forged', 'Forged')", [fx.schoolA, user]));
    await denied(rows(USERS.adminA,
      "INSERT INTO announcements (school_id, author_user_id, title, body) VALUES ($1, $2, 'Forged', 'Forged')", [fx.schoolA, USERS.adminA]));
    await pending(user, request.id);
  });

  it("submission SQL enforces verified email, supported role, duplicate pending and current identity", async () => {
    const user = account();
    await syncProfile(api, user, emailOf(user));
    const [request] = await rows(user, "SELECT * FROM app_private.submit_join_request($1, $2, $3)",
      [fx.schoolA, "teacher", JSON.stringify({ fullName: "Direct Applicant" })]);
    assert.equal(request.auth_user_id, user);
    assert.equal(request.status, "pending");
    await denied(rows(user, "SELECT * FROM app_private.submit_join_request($1, $2, $3)",
      [fx.schoolA, "teacher", JSON.stringify({ fullName: "Duplicate Applicant" })]), ["23505"]);
    await denied(rows(user, "SELECT * FROM app_private.submit_join_request($1, $2, $3)",
      [fx.schoolA, "owner", JSON.stringify({ fullName: "Privileged Applicant" })]), ["22023"]);
    const unverified = account({ email: null });
    await rows(unverified, "SELECT app_private.sync_user_profile($1, 'Unverified', NULL, NULL)", [unverified]);
    await denied(rows(unverified, "SELECT * FROM app_private.submit_join_request($1, $2, $3)",
      [fx.schoolA, "teacher", JSON.stringify({ fullName: "Unverified Applicant", email: "forged@example.test" })]));
    assert.deepEqual(await rows(user, "SELECT id FROM school_memberships WHERE school_id = $1", [fx.schoolA]), []);
  });

  it("review SQL enforces manager/no-self/cross-school checks rather than relying on HTTP middleware", async () => {
    const user = account();
    const request = await submit(user);
    const query = "SELECT * FROM app_private.review_join_request($1, $2, $3, $4, $5, $6)";
    await denied(rows(user, query, [fx.schoolA, request.id, "approved", null, null, null]));
    await denied(rows(USERS.teacherA, query, [fx.schoolA, request.id, "approved", null, null, null]));
    await denied(rows(USERS.ownerB, query, [fx.schoolB, request.id, "approved", null, null, null]), ["P0002"]);
    const self = await submit(USERS.adminA, "teacher", { staffNumber: "ADMIN-TEACHER" });
    await denied(rows(USERS.adminA, query, [fx.schoolA, self.id, "approved", null, null, null]));
    await pending(user, request.id);
  });

  it("direct concurrent decisions commit one review, one membership and one decision notification", async () => {
    const user = account();
    const request = await submit(user);
    const query = "SELECT * FROM app_private.review_join_request($1, $2, 'approved', NULL, NULL, NULL)";
    const results = await Promise.allSettled([
      rows(USERS.adminA, query, [fx.schoolA, request.id]),
      rows(USERS.ownerA, query, [fx.schoolA, request.id]),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    for (const result of results) {
      if (result.status === "rejected") assert.equal(result.reason.code, "P0002");
    }
    assert.equal((await rows(user, "SELECT id FROM school_memberships WHERE school_id = $1 AND role = 'teacher'", [fx.schoolA])).length, 1);
    assert.equal((await rows(user, "SELECT id FROM notifications WHERE entity_id = $1", [request.id])).length, 1);
    await denied(rows(USERS.adminA, query, [fx.schoolA, request.id]), ["P0002"]);
  });

  it("selected-school invitation SQL rejects mismatches before consumption and stores only a hash", async () => {
    const user = account();
    const invitation = await invite(user);
    await syncProfile(api, user, emailOf(user));
    const query = "SELECT * FROM app_private.accept_school_invitation($1, $2, $3)";
    await denied(rows(user, query, [hashToken(invitation.token), fx.schoolB, "teacher"]), ["P0002"]);
    await denied(rows(user, query, [hashToken(invitation.token), fx.schoolA, "school_admin"]), ["P0002"]);
    await denied(rows(user, query, [invitation.token, fx.schoolA, "teacher"]), ["P0002"]);
    assert.equal((await rows(USERS.adminA, "SELECT status FROM invitations WHERE id = $1", [invitation.id]))[0].status, "pending");
    const [accepted] = await rows(user, query, [hashToken(invitation.token), fx.schoolA, "teacher"]);
    assert.equal(accepted.school_id, fx.schoolA);
    assert.equal(accepted.role, "teacher");
    await denied(rows(user, query, [hashToken(invitation.token), fx.schoolA, "teacher"]), ["P0002"]);
  });
});
