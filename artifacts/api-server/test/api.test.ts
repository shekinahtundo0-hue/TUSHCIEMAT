import assert from "node:assert/strict";
import { createSign, generateKeyPairSync } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import { sql } from "drizzle-orm";
import { createLocalJWKSet } from "jose";
import pg from "pg";
import pino from "pino";
import { createApp } from "../src/app";
import { loadConfig } from "../src/config/env";
import { createDatabase, createPool, type Database } from "../src/lib/database";
import { firebaseIdentityVerifier, type VerifiedProfile } from "../src/lib/identity";
import { startTestDatabase, type TestDatabase } from "./support/database";
import { USERS, buildFixture, type Fixture } from "./support/fixture";

const FRONTEND = "http://localhost:5173";
const PROJECT_ID = "tushciemat-test";
const KEY_ID = "test-key-1";

const signingKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const otherKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });

let db: TestDatabase;
let database: Database;
let server: Server;
let baseUrl: string;
let fx: Fixture;

// Profile claims carried in each test user's ID token. Unlisted users get a verified default.
const tokenProfiles = new Map<string, VerifiedProfile & { emailVerified?: boolean }>();
const identity = firebaseIdentityVerifier(
  PROJECT_ID,
  createLocalJWKSet({
    keys: [{ ...signingKeys.publicKey.export({ format: "jwk" }), kid: KEY_ID, alg: "RS256", use: "sig" }],
  }),
);

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function sessionToken(
  sub: string,
  options: {
    expiresIn?: number;
    audience?: string;
    issuer?: string;
    authTime?: number;
    key?: typeof signingKeys.privateKey;
  } = {},
): string {
  const now = Math.floor(Date.now() / 1000);
  const handle = sub.replace("user_", "");
  const profile = tokenProfiles.get(sub) ?? {
    fullName: handle,
    email: `${handle.toLowerCase()}@example.test`,
    imageUrl: null,
  };
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: KEY_ID }));
  const payload = base64url(
    JSON.stringify({
      sub,
      user_id: sub,
      iss: options.issuer ?? `https://securetoken.google.com/${PROJECT_ID}`,
      aud: options.audience ?? PROJECT_ID,
      auth_time: options.authTime ?? now - 30,
      iat: now - 5,
      exp: now + (options.expiresIn ?? 60),
      ...(profile.fullName ? { name: profile.fullName } : {}),
      ...(profile.email ? { email: profile.email, email_verified: profile.emailVerified ?? true } : {}),
      firebase: { sign_in_provider: "password", identities: {} },
    }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  return `${header}.${payload}.${signer.sign(options.key ?? signingKeys.privateKey).toString("base64url")}`;
}

type Call = {
  as?: string | null;
  token?: string;
  school?: string;
  body?: unknown;
  rawBody?: string;
  headers?: Record<string, string>;
};

async function call(method: string, path: string, options: Call = {}) {
  const headers: Record<string, string> = { ...options.headers };
  const token = options.token ?? (options.as ? sessionToken(options.as) : undefined);
  if (token) headers.authorization = `Bearer ${token}`;
  if (options.school) headers["x-school-id"] = options.school;
  let body: string | undefined;
  if (options.rawBody !== undefined) {
    body = options.rawBody;
    headers["content-type"] ??= "application/json";
  } else if (options.body !== undefined) {
    body = JSON.stringify(options.body);
    headers["content-type"] = "application/json";
  }
  const response = await fetch(`${baseUrl}${path}`, { method, headers, body });
  const text = await response.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json: any = text ? JSON.parse(text) : null;
  return { status: response.status, json, headers: response.headers };
}

function assertError(result: Awaited<ReturnType<typeof call>>, status: number, code?: string) {
  assert.equal(result.status, status, JSON.stringify(result.json));
  assert.ok(result.json?.error?.requestId, "error envelope carries a request id");
  if (code) assert.equal(result.json.error.code, code);
}

before(async () => {
  db = await startTestDatabase();
  const config = loadConfig({
    NODE_ENV: "test",
    PORT: "1",
    DATABASE_URL: db.apiUrl,
    FIREBASE_PROJECT_ID: PROJECT_ID,
    CORS_ALLOWED_ORIGINS: FRONTEND,
  });
  const pool = createPool({ connectionString: config.databaseUrl, max: 6, caCert: null });
  database = createDatabase(pool);
  fx = await buildFixture(pool);

  const app = createApp({ config, database, identity, logger: pino({ level: "silent" }) });
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  await database?.pool.end();
  await db?.stop();
});

describe("health and plumbing", () => {
  it("serves liveness without auth on both paths", async () => {
    assert.equal((await call("GET", "/api/v1/healthz")).status, 200);
    assert.equal((await call("GET", "/api/healthz")).status, 200);
  });

  it("readiness checks the database", async () => {
    const result = await call("GET", "/api/v1/readyz");
    assert.equal(result.status, 200);
    assert.equal(result.json.status, "ready");
  });

  it("echoes a valid request id and returns the error envelope for unknown routes", async () => {
    const result = await call("GET", "/api/v1/nope", { headers: { "x-request-id": "req-12345678" } });
    assertError(result, 401);
    assert.equal(result.headers.get("x-request-id"), "req-12345678");
    assertError(await call("GET", "/elsewhere"), 404, "not_found");
  });

  it("sets security headers and only allows listed origins", async () => {
    const allowed = await call("GET", "/api/v1/me", { headers: { origin: FRONTEND } });
    assert.equal(allowed.headers.get("access-control-allow-origin"), FRONTEND);
    assert.equal(allowed.headers.get("access-control-expose-headers"), "X-Request-Id");
    assert.equal(allowed.headers.get("x-content-type-options"), "nosniff");
    const other = await call("GET", "/api/v1/me", { headers: { origin: "https://evil.example" } });
    assert.equal(other.headers.get("access-control-allow-origin"), null);
  });

  it("rejects malformed JSON", async () => {
    assertError(
      await call("POST", "/api/v1/schools", { as: USERS.outsider, rawBody: "{not json" }),
      400,
      "invalid_json",
    );
  });
});

describe("authentication", () => {
  it("requires a session token", async () => {
    assertError(await call("GET", "/api/v1/me"), 401, "unauthenticated");
  });

  it("rejects expired, tampered, foreign-key and other-project tokens", async () => {
    assertError(await call("GET", "/api/v1/me", { token: sessionToken(USERS.ownerA, { expiresIn: -120 }) }), 401);
    const valid = sessionToken(USERS.ownerA);
    const [h, p, s] = valid.split(".");
    const forged = base64url(JSON.stringify({ ...JSON.parse(Buffer.from(p, "base64url").toString()), sub: USERS.ownerB }));
    assertError(await call("GET", "/api/v1/me", { token: `${h}.${forged}.${s}` }), 401);
    assertError(
      await call("GET", "/api/v1/me", { token: sessionToken(USERS.ownerA, { key: otherKeys.privateKey }) }),
      401,
    );
    assertError(await call("GET", "/api/v1/me", { token: sessionToken(USERS.ownerA, { audience: "other-project" }) }), 401);
    assertError(
      await call("GET", "/api/v1/me", {
        token: sessionToken(USERS.ownerA, { issuer: "https://securetoken.google.com/other-project" }),
      }),
      401,
    );
    assertError(
      await call("GET", "/api/v1/me", {
        token: sessionToken(USERS.ownerA, { authTime: Math.floor(Date.now() / 1000) + 600 }),
      }),
      401,
    );
    assertError(await call("GET", "/api/v1/me", { headers: { authorization: "Basic abc" } }), 401);
  });

  it("returns the verified profile and memberships", async () => {
    const result = await call("GET", "/api/v1/me", { as: USERS.ownerA });
    assert.equal(result.status, 200, JSON.stringify(result.json));
    assert.equal(result.json.authUserId, USERS.ownerA);
    assert.deepEqual(result.json.schools, [
      {
        schoolId: fx.schoolA,
        schoolName: "Amani Secondary",
        roles: ["owner"],
        capabilities: [
          "students.manage", "academics.manage", "attendance.manage", "people.manage",
          "requests.review", "settings.manage", "announcements.manage",
          "assessments.manage", "results.publish", "resources.manage", "records.delete",
        ],
      },
    ]);
  });

  it("creates a profile on first sign-in from token claims", async () => {
    tokenProfiles.set("user_firstvisit", { fullName: "First Visit", email: "first@example.test", imageUrl: null });
    const result = await call("GET", "/api/v1/me", { as: "user_firstvisit" });
    assert.equal(result.status, 200, JSON.stringify(result.json));
    assert.equal(result.json.email, "first@example.test");
    assert.deepEqual(result.json.schools, []);
  });

  it("ignores unverified email claims and refreshes the profile when claims change", async () => {
    tokenProfiles.set("user_changing", {
      fullName: "Before",
      email: "changing@example.test",
      imageUrl: null,
      emailVerified: false,
    });
    let result = await call("GET", "/api/v1/me", { as: "user_changing" });
    assert.equal(result.status, 200, JSON.stringify(result.json));
    assert.equal(result.json.email, null);
    tokenProfiles.set("user_changing", { fullName: "After", email: "changing@example.test", imageUrl: null });
    result = await call("GET", "/api/v1/me", { as: "user_changing" });
    assert.equal(result.json.fullName, "After");
    assert.equal(result.json.email, "changing@example.test");
  });

  it("blocks disabled accounts", async () => {
    await call("GET", "/api/v1/me", { as: "user_disabled" });
    await db.owner.query("UPDATE user_profiles SET status = 'disabled' WHERE auth_user_id = 'user_disabled'");
    assertError(await call("GET", "/api/v1/me", { as: "user_disabled" }), 403);
  });
});

describe("school context and tenant isolation", () => {
  it("requires X-School-Id for school-scoped routes", async () => {
    assertError(await call("GET", "/api/v1/students", { as: USERS.ownerA }), 400, "school_required");
    assertError(await call("GET", "/api/v1/students", { as: USERS.ownerA, school: "not-a-uuid" }), 400, "school_required");
  });

  it("refuses a school the caller does not belong to", async () => {
    assertError(await call("GET", "/api/v1/students", { as: USERS.ownerA, school: fx.schoolB }), 403);
  });

  it("does not reveal another school's records through this school", async () => {
    assertError(await call("GET", `/api/v1/students/${fx.studentB}`, { as: USERS.ownerA, school: fx.schoolA }), 404);
    const list = await call("GET", "/api/v1/students", { as: USERS.ownerA, school: fx.schoolA });
    assert.equal(list.status, 200);
    assert.deepEqual(list.json.items.map((s: { admissionNumber: string }) => s.admissionNumber).sort(), ["A-001", "A-002"]);
  });

  it("creates a school with the caller as owner", async () => {
    const created = await call("POST", "/api/v1/schools", {
      as: USERS.outsider,
      body: {
        name: "Chanzo Primary",
        category: "primary",
        curriculum: "CBC",
        county: "Kisumu",
        academicYear: { name: "2026", startsOn: "2026-01-05", endsOn: "2026-11-27" },
      },
    });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    const me = await call("GET", "/api/v1/me", { as: USERS.outsider });
    assert.deepEqual(me.json.schools, [{
      schoolId: created.json.id,
      schoolName: "Chanzo Primary",
      roles: ["owner"],
      capabilities: [
        "students.manage", "academics.manage", "attendance.manage", "people.manage",
        "requests.review", "settings.manage", "announcements.manage",
        "assessments.manage", "results.publish", "resources.manage", "records.delete",
      ],
    }]);
    const years = await call("GET", "/api/v1/academic-years", { as: USERS.outsider, school: created.json.id });
    assert.equal(years.json.length, 1);
    assert.equal(years.json[0].isCurrent, true);
  });

  it("validates bodies against the contract", async () => {
    assertError(
      await call("POST", "/api/v1/students", { as: USERS.adminA, school: fx.schoolA, body: { firstName: "" } }),
      400,
      "validation_failed",
    );
  });
});

describe("role-aware access", () => {
  it("shows a teacher only their assigned classes and learners", async () => {
    const classes = await call("GET", "/api/v1/classes", { as: USERS.teacherA, school: fx.schoolA });
    assert.equal(classes.status, 200, JSON.stringify(classes.json));
    assert.deepEqual(classes.json.map((c: { id: string }) => c.id), [fx.class1]);

    const students = await call("GET", "/api/v1/students", { as: USERS.teacherA, school: fx.schoolA });
    assert.deepEqual(students.json.items.map((s: { id: string }) => s.id), [fx.student1]);
    assert.equal(students.json.items[0].guardianCount, null, "teachers do not see guardian data");

    assertError(await call("GET", `/api/v1/students/${fx.student2}`, { as: USERS.teacherA, school: fx.schoolA }), 404);
    const detail = await call("GET", `/api/v1/students/${fx.student1}`, { as: USERS.teacherA, school: fx.schoolA });
    assert.equal(detail.json.guardians, null);
  });

  it("lets a teacher take attendance for their class only", async () => {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi" }).format(new Date());
    const saved = await call("POST", "/api/v1/attendance", {
      as: USERS.teacherA,
      school: fx.schoolA,
      body: { classId: fx.class1, date: today, records: [{ studentId: fx.student1, status: "late", note: "Bus" }] },
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    assert.equal(saved.json.entries[0].status, "late");

    assertError(
      await call("GET", `/api/v1/attendance?classId=${fx.class2}&date=${today}`, { as: USERS.teacherA, school: fx.schoolA }),
      404,
    );
    assertError(
      await call("POST", "/api/v1/attendance", {
        as: USERS.teacherA,
        school: fx.schoolA,
        body: { classId: fx.class1, date: today, records: [{ studentId: fx.student2, status: "present" }] },
      }),
      400,
    );
    assertError(
      await call("POST", "/api/v1/attendance", {
        as: USERS.teacherA,
        school: fx.schoolA,
        body: { classId: fx.class1, date: "2099-01-01", records: [{ studentId: fx.student1, status: "present" }] },
      }),
      400,
    );
  });

  it("gives the bursar guardian counts but no attendance or writes", async () => {
    const students = await call("GET", "/api/v1/students", { as: USERS.bursarA, school: fx.schoolA });
    assert.equal(students.status, 200);
    const first = students.json.items.find((s: { id: string }) => s.id === fx.student1);
    assert.equal(first.guardianCount, 1);
    assertError(await call("GET", `/api/v1/attendance?classId=${fx.class1}&date=2026-03-02`, { as: USERS.bursarA, school: fx.schoolA }), 403);
    assertError(
      await call("POST", "/api/v1/students", {
        as: USERS.bursarA,
        school: fx.schoolA,
        body: { firstName: "X", lastName: "Y", admissionNumber: "A-999" },
      }),
      403,
    );
  });

  it("shows parents and learners only their own records", async () => {
    const children = await call("GET", "/api/v1/portal/children", { as: USERS.parentA, school: fx.schoolA });
    assert.equal(children.status, 200, JSON.stringify(children.json));
    assert.deepEqual(children.json.map((c: { studentId: string }) => c.studentId), [fx.student1]);
    assert.equal(children.json[0].attendance.late, 1);

    const learner = await call("GET", "/api/v1/portal/learner", { as: USERS.studentA, school: fx.schoolA });
    assert.equal(learner.status, 200, JSON.stringify(learner.json));
    assert.equal(learner.json.studentId, fx.student1);

    assertError(await call("GET", "/api/v1/students", { as: USERS.parentA, school: fx.schoolA }), 403);
    assertError(await call("GET", "/api/v1/portal/children", { as: USERS.teacherA, school: fx.schoolA }), 403);
  });

  it("restricts the platform view to platform staff", async () => {
    assertError(await call("GET", "/api/v1/platform/schools", { as: USERS.ownerA }), 403);
    await db.owner.query("UPDATE user_profiles SET platform_role = 'platform_support' WHERE auth_user_id = $1", [USERS.ownerB]);
    const result = await call("GET", "/api/v1/platform/schools", { as: USERS.ownerB });
    assert.equal(result.status, 200, JSON.stringify(result.json));
    assert.ok(result.json.length >= 2);
    assert.equal(typeof result.json[0].activeMembers, "number");
  });
});

describe("guardians", () => {
  it("reuses a matching guardian and rejects an email held under another name", async () => {
    const reuse = await call("POST", `/api/v1/students/${fx.student2}/guardians`, {
      as: USERS.adminA,
      school: fx.schoolA,
      body: { fullName: "parent a", email: "ParentA@example.test", relationship: "mother" },
    });
    assert.equal(reuse.status, 201, JSON.stringify(reuse.json));
    assert.equal(reuse.json.guardianId, fx.guardian1);

    assertError(
      await call("POST", `/api/v1/students/${fx.student2}/guardians`, {
        as: USERS.adminA,
        school: fx.schoolA,
        body: { fullName: "Someone Else", email: "parenta@example.test", relationship: "father" },
      }),
      409,
    );
  });
});

describe("members and invitations", () => {
  it("prevents changing your own access and owner memberships without being owner", async () => {
    const members = await call("GET", "/api/v1/members", { as: USERS.adminA, school: fx.schoolA });
    assert.equal(members.status, 200, JSON.stringify(members.json));
    const own = members.json.find((m: { authUserId: string }) => m.authUserId === USERS.adminA);
    const owner = members.json.find((m: { role: string }) => m.role === "owner");
    assertError(
      await call("PATCH", `/api/v1/members/${own.membershipId}`, { as: USERS.adminA, school: fx.schoolA, body: { status: "suspended" } }),
      403,
    );
    assertError(
      await call("PATCH", `/api/v1/members/${owner.membershipId}`, { as: USERS.adminA, school: fx.schoolA, body: { status: "suspended" } }),
      403,
    );
    assertError(await call("GET", "/api/v1/members", { as: USERS.teacherA, school: fx.schoolA }), 403);
  });

  it("suspending a member removes their access", async () => {
    const members = await call("GET", "/api/v1/members", { as: USERS.ownerA, school: fx.schoolA });
    const target = members.json.find((m: { authUserId: string }) => m.authUserId === USERS.teacherA2);
    const updated = await call("PATCH", `/api/v1/members/${target.membershipId}`, {
      as: USERS.ownerA,
      school: fx.schoolA,
      body: { status: "suspended" },
    });
    assert.equal(updated.status, 200, JSON.stringify(updated.json));
    assert.equal(updated.json.status, "suspended");
    assertError(await call("GET", "/api/v1/classes", { as: USERS.teacherA2, school: fx.schoolA }), 403);
  });

  it("invites, enforces the verified email, accepts once", async () => {
    assertError(
      await call("POST", "/api/v1/invitations", {
        as: USERS.adminA,
        school: fx.schoolA,
        body: { email: "boss@example.test", role: "owner" },
      }),
      403,
    );

    const created = await call("POST", "/api/v1/invitations", {
      as: USERS.adminA,
      school: fx.schoolA,
      body: { email: "New.Teacher@Example.test", role: "teacher" },
    });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    assert.equal(created.headers.get("cache-control"), "no-store");
    assert.match(created.json.acceptPath, /^\/accept-invite#[A-Za-z0-9_-]{43}$/);
    assert.equal(created.json.invitation.email, "new.teacher@example.test");
    const token = created.json.acceptPath.split("#")[1];

    assertError(
      await call("POST", "/api/v1/invitations", {
        as: USERS.adminA,
        school: fx.schoolA,
        body: { email: "new.teacher@example.test", role: "teacher" },
      }),
      409,
    );

    assertError(await call("POST", "/api/v1/invitations/accept", { as: USERS.outsider, body: { token } }), 403);

    tokenProfiles.set("user_newteacher", { fullName: "New Teacher", email: "new.teacher@example.test", imageUrl: null });
    const accepted = await call("POST", "/api/v1/invitations/accept", { as: "user_newteacher", body: { token } });
    assert.equal(accepted.status, 200, JSON.stringify(accepted.json));
    assert.deepEqual(accepted.json, { schoolId: fx.schoolA, role: "teacher" });

    assertError(await call("POST", "/api/v1/invitations/accept", { as: "user_newteacher", body: { token } }), 404);
    const list = await call("GET", "/api/v1/invitations", { as: USERS.adminA, school: fx.schoolA });
    const row = list.json.find((i: { id: string }) => i.id === created.json.invitation.id);
    assert.equal(row.status, "accepted");
  });

  it("requires a verified email to accept", async () => {
    tokenProfiles.set("user_unverified", {
      fullName: "Unverified",
      email: "unverified@example.test",
      imageUrl: null,
      emailVerified: false,
    });
    assertError(
      await call("POST", "/api/v1/invitations/accept", { as: "user_unverified", body: { token: "x".repeat(43) } }),
      403,
    );
  });

  it("revokes only pending invitations", async () => {
    // Privileged roles such as bursar are owner-only grants.
    assertError(
      await call("POST", "/api/v1/invitations", {
        as: USERS.adminA,
        school: fx.schoolA,
        body: { email: "bursar2@example.test", role: "bursar" },
      }),
      403,
    );
    const created = await call("POST", "/api/v1/invitations", {
      as: USERS.ownerA,
      school: fx.schoolA,
      body: { email: "bursar2@example.test", role: "bursar" },
    });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    const id = created.json.invitation.id;
    const revoked = await call("POST", `/api/v1/invitations/${id}/revoke`, { as: USERS.ownerA, school: fx.schoolA });
    assert.equal(revoked.status, 200, JSON.stringify(revoked.json));
    assert.equal(revoked.json.status, "revoked");
    assertError(await call("POST", `/api/v1/invitations/${id}/revoke`, { as: USERS.ownerA, school: fx.schoolA }), 409);
  });

  it("ties parent invitations to the guardian's email on file", async () => {
    const guardian = await db.owner.query(
      `INSERT INTO guardians (school_id, full_name, email) VALUES ($1, 'Baba Otieno', 'baba@example.test') RETURNING id`,
      [fx.schoolA],
    );
    assertError(
      await call("POST", "/api/v1/invitations", {
        as: USERS.adminA,
        school: fx.schoolA,
        body: { email: "someone@example.test", role: "parent", guardianId: guardian.rows[0].id },
      }),
      400,
    );
    assertError(
      await call("POST", "/api/v1/invitations", {
        as: USERS.adminA,
        school: fx.schoolA,
        body: { email: "parenta@example.test", role: "parent", guardianId: fx.guardian1 },
      }),
      409,
    );
  });
});

describe("account erasure", () => {
  it("anonymises a profile through the trusted routine and then blocks it", async () => {
    assert.equal((await call("GET", "/api/v1/me", { as: "user_erased" })).status, 200);
    await database.asUser("user_erased", (tx) => tx.execute(sql`select app_private.mark_user_deleted('user_erased')`));
    const profile = await db.owner.query(
      "SELECT email, full_name, status FROM user_profiles WHERE auth_user_id = 'user_erased'",
    );
    assert.deepEqual(profile.rows[0], { email: null, full_name: null, status: "deleted" });
    assertError(await call("GET", "/api/v1/me", { as: "user_erased" }), 403);
  });
});
