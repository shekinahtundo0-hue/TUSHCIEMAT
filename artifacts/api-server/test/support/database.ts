import { mkdtemp } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import { runMigrations } from "@workspace/db/migrate";
const OWNER_PASSWORD = "owner-test-password";
const API_PASSWORD = "api-test-password";

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() =>
        typeof address === "object" && address ? resolve(address.port) : reject(new Error("no port")),
      );
    });
  });
}

export type TestDatabase = {
  ownerUrl: string;
  apiUrl: string;
  owner: pg.Pool;
  stop: () => Promise<void>;
};

// Mirrors production: migrations run as the schema owner, the API logs in as tushciemat_api.
export async function startTestDatabase(): Promise<TestDatabase> {
  const port = await freePort();
  const databaseDir = await mkdtemp(path.join(os.tmpdir(), "tushciemat-pg-"));
  const server = new EmbeddedPostgres({
    databaseDir,
    port,
    user: "postgres",
    password: OWNER_PASSWORD,
    authMethod: "scram-sha-256",
    persistent: false,
    onLog: () => {},
  });
  await server.initialise();
  await server.start();
  await server.createDatabase("tushciemat");

  const ownerUrl = `postgres://postgres:${OWNER_PASSWORD}@127.0.0.1:${port}/tushciemat`;
  const apiUrl = `postgres://tushciemat_api:${API_PASSWORD}@127.0.0.1:${port}/tushciemat`;
  const owner = new pg.Pool({ connectionString: ownerUrl, max: 4 });

  await runMigrations(ownerUrl);
  // Operator step documented in docs/deployment.md: give the API role a login.
  await owner.query(`ALTER ROLE tushciemat_api WITH LOGIN PASSWORD '${API_PASSWORD}'`);

  return {
    ownerUrl,
    apiUrl,
    owner,
    stop: async () => {
      await owner.end();
      await server.stop();
    },
  };
}

/** Runs fn in a transaction as tushciemat_api with the given verified user id. */
export async function asUser<T>(
  pool: pg.Pool,
  authUserId: string | null,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (authUserId) {
      await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: authUserId }),
      ]);
    }
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
