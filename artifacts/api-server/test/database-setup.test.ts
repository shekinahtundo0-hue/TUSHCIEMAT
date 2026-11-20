import assert from "node:assert/strict";
import { it } from "node:test";
import pg from "pg";
import { startTestDatabase } from "./support/database";

it("stops the temporary database and preserves a migration failure", { timeout: 120_000 }, async () => {
  let failedDatabaseUrl = "";
  await assert.rejects(
    startTestDatabase(async (connectionString) => {
      failedDatabaseUrl = connectionString;
      const pool = new pg.Pool({ connectionString, max: 1 });
      try {
        await pool.query("CREATE TABLE invalid_migration (id integer, UNIQUE (id) WHERE id > 0)");
      } finally {
        await pool.end();
      }
    }),
    (error: Error & { code?: string }) => error.code === "42601",
  );
  assert.ok(failedDatabaseUrl);
  const probe = new pg.Pool({ connectionString: failedDatabaseUrl, connectionTimeoutMillis: 1000 });
  try {
    await assert.rejects(probe.query("SELECT 1"), (error: Error & { code?: string }) => error.code === "ECONNREFUSED");
  } finally {
    await probe.end();
  }
});
