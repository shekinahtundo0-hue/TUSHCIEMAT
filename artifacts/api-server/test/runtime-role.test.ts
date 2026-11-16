import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { sql } from "drizzle-orm";
import type pg from "pg";
import { createDatabase, createPool, type Database } from "../src/lib/database";
import { startTestDatabase, type TestDatabase } from "./support/database";

const UNSAFE_ROLE = /Unsafe database role: expected tushciemat_api/;
const pools: pg.Pool[] = [];
let db: TestDatabase;
let database: Database;
let wrongUrl: string;

function databaseFor(connectionString: string): Database {
  const pool = createPool({ connectionString, max: 1, caCert: null });
  pools.push(pool);
  return createDatabase(pool);
}

async function sessionState(target: Database) {
  const result = await target.pool.query<{
    pid: number;
    claims: string | null;
    timeout: string;
  }>(`select pg_catalog.pg_backend_pid() as pid,
    nullif(pg_catalog.current_setting('request.jwt.claims', true), '') as claims,
    pg_catalog.current_setting('statement_timeout') as timeout`);
  return result.rows[0];
}

async function assertRejected(target: Database): Promise<void> {
  let callbackRan = false;
  await assert.rejects(
    target.asUser("runtime-role-user", async () => {
      callbackRan = true;
    }),
    UNSAFE_ROLE,
  );
  assert.equal(callbackRan, false, "unsafe connections must never enter the application callback");
  await assert.rejects(target.ping(), UNSAFE_ROLE);
}

before(async () => {
  db = await startTestDatabase();
  database = databaseFor(db.apiUrl);
  await db.owner.query(`
    CREATE ROLE gate4_wrong_login LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD 'wrong-test-password';
    GRANT tushciemat_api TO gate4_wrong_login;
    CREATE ROLE gate4_effective_role NOLOGIN NOSUPERUSER NOBYPASSRLS;
    GRANT gate4_effective_role TO tushciemat_api;
  `);
  const url = new URL(db.apiUrl);
  url.username = "gate4_wrong_login";
  url.password = "wrong-test-password";
  wrongUrl = url.toString();
});

after(async () => {
  for (const pool of pools) await pool.end();
  await db?.stop();
});

describe("runtime database role guard", { concurrency: false }, () => {
  it("accepts the real non-bypass login and keeps parameterized identity and timeout transaction-local", async () => {
    const baseline = await sessionState(database);
    assert.equal(baseline.claims, null);
    await database.ping();
    const userId = "runtime-'quoted\"\\user";
    const value = await database.asUser(userId, async (tx) => {
      const result = await tx.execute<{
        login: string;
        effective: string;
        rolcanlogin: boolean;
        rolsuper: boolean;
        rolbypassrls: boolean;
        claims: { sub: string; role: string };
        timeout: string;
        pid: number;
      }>(sql`select session_user as login, current_user as effective,
        rolcanlogin, rolsuper, rolbypassrls,
        pg_catalog.current_setting('request.jwt.claims')::json as claims,
        pg_catalog.current_setting('statement_timeout') as timeout,
        pg_catalog.pg_backend_pid() as pid
        from pg_catalog.pg_roles where rolname = current_user`);
      assert.deepEqual(result.rows, [{
        login: "tushciemat_api",
        effective: "tushciemat_api",
        rolcanlogin: true,
        rolsuper: false,
        rolbypassrls: false,
        claims: { sub: userId, role: "tushciemat_api" },
        timeout: "15s",
        pid: baseline.pid,
      }]);
      return "callback-result";
    });
    assert.equal(value, "callback-result");
    assert.deepEqual(await sessionState(database), baseline);
  });

  it("clears identity and timeout after callback rollback before reusing the connection", async () => {
    const baseline = await sessionState(database);
    const failure = new Error("callback failed");
    await assert.rejects(database.asUser("rolled-back-user", async () => {
      throw failure;
    }), (error) => error === failure);
    assert.deepEqual(await sessionState(database), baseline);
    await database.asUser("next-user", async (tx) => {
      const result = await tx.execute<{ sub: string }>(
        sql`select pg_catalog.current_setting('request.jwt.claims')::json->>'sub' as sub`,
      );
      assert.equal(result.rows[0].sub, "next-user");
    });
    assert.deepEqual(await sessionState(database), baseline);
  });

  it("rejects the schema owner before the callback and from ping", async () => {
    const owner = databaseFor(db.ownerUrl);
    const baseline = await sessionState(owner);
    await assertRejected(owner);
    assert.deepEqual(await sessionState(owner), baseline);
  });

  it("rejects a differently named non-bypass login even with API membership and SET ROLE", async () => {
    const wrong = databaseFor(wrongUrl);
    const role = await wrong.pool.query(`select session_user as login,
      rolcanlogin, rolsuper, rolbypassrls
      from pg_catalog.pg_roles where rolname = current_user`);
    assert.deepEqual(role.rows, [{
      login: "gate4_wrong_login", rolcanlogin: true, rolsuper: false, rolbypassrls: false,
    }]);
    await assertRejected(wrong);
    await wrong.pool.query("SET ROLE tushciemat_api");
    await assertRejected(wrong);
  });

  it("does not accept owner login disguised by SET ROLE and forged claims", async () => {
    const owner = databaseFor(db.ownerUrl);
    await owner.pool.query("SELECT pg_catalog.set_config('request.jwt.claims', $1, false)", [
      JSON.stringify({ sub: "runtime-role-user", role: "tushciemat_api" }),
    ]);
    await owner.pool.query("SET ROLE tushciemat_api");
    const role = await owner.pool.query("SELECT session_user as login, current_user as effective");
    assert.deepEqual(role.rows, [{ login: "postgres", effective: "tushciemat_api" }]);
    await assertRejected(owner);
  });

  it("rejects a correct login when its effective role has changed", async () => {
    const changed = databaseFor(db.apiUrl);
    await changed.ping();
    await changed.pool.query("SET ROLE gate4_effective_role");
    const role = await changed.pool.query("SELECT session_user as login, current_user as effective");
    assert.deepEqual(role.rows, [{ login: "tushciemat_api", effective: "gate4_effective_role" }]);
    await assertRejected(changed);
  });

  for (const [unsafe, restore] of [
    ["SUPERUSER", "NOSUPERUSER"],
    ["BYPASSRLS", "NOBYPASSRLS"],
    ["NOLOGIN", "LOGIN"],
  ]) {
    it(`rechecks ${unsafe} on an already validated pooled connection`, async () => {
      await database.ping();
      await database.asUser("previous-user", async () => {});
      const baseline = await sessionState(database);
      try {
        await db.owner.query(`ALTER ROLE tushciemat_api ${unsafe}`);
        await assertRejected(database);
        assert.deepEqual(await sessionState(database), baseline);
      } finally {
        await db.owner.query(`ALTER ROLE tushciemat_api ${restore}`);
      }
      await database.ping();
    });
  }
});
