import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import { runMigrations } from "@workspace/db/migrate";

// Local development only: a persistent Postgres under <repo>/.local (gitignored).
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const baseDir = path.join(root, ".local", "dev-db");
const dataDir = path.join(baseDir, "data");
const credentialsFile = path.join(baseDir, "credentials.json");
const port = Number(process.env.DEV_DB_PORT ?? 54329);

type Credentials = { ownerPassword: string; apiPassword: string };

async function credentials(): Promise<Credentials> {
  if (existsSync(credentialsFile)) return JSON.parse(await readFile(credentialsFile, "utf8"));
  const created = {
    ownerPassword: randomBytes(18).toString("base64url"),
    apiPassword: randomBytes(18).toString("base64url"),
  };
  await mkdir(baseDir, { recursive: true });
  await writeFile(credentialsFile, JSON.stringify(created, null, 2));
  return created;
}

const creds = await credentials();
const fresh = !existsSync(path.join(dataDir, "PG_VERSION"));
const server = new EmbeddedPostgres({
  databaseDir: dataDir,
  port,
  user: "postgres",
  password: creds.ownerPassword,
  authMethod: "scram-sha-256",
  persistent: true,
  onLog: () => {},
});

if (fresh) await server.initialise();
await server.start();
if (fresh) await server.createDatabase("tushciemat");

const ownerUrl = `postgres://postgres:${creds.ownerPassword}@127.0.0.1:${port}/tushciemat`;
const apiUrl = `postgres://tushciemat_api:${creds.apiPassword}@127.0.0.1:${port}/tushciemat`;

await runMigrations(ownerUrl);
const owner = new pg.Pool({ connectionString: ownerUrl, max: 1 });
await owner.query(`ALTER ROLE tushciemat_api WITH LOGIN PASSWORD '${creds.apiPassword}'`);
await owner.end();

console.log(`Local database ready on 127.0.0.1:${port} (migrations applied).`);
console.log(`DATABASE_URL=${apiUrl}`);
console.log(`MIGRATION_DATABASE_URL=${ownerUrl}`);

const stop = async () => {
  await server.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
setInterval(() => {}, 1 << 30);
