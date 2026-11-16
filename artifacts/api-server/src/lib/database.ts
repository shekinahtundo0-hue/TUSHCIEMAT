import { drizzle, type NodePgDatabase, type NodePgTransaction } from "drizzle-orm/node-postgres";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import { sql } from "drizzle-orm";
import pg from "pg";
import * as schema from "@workspace/db/schema";

export type Schema = typeof schema;
export type Db = NodePgDatabase<Schema>;
export type Tx = NodePgTransaction<Schema, ExtractTablesWithRelations<Schema>>;

export interface Database {
  pool: pg.Pool;
  db: Db;
  /**
   * Runs `fn` in one transaction as the given verified user. The identity is
   * transaction-local, so it cannot leak to the next request on the same
   * pooled connection. RLS policies read it via app_private.current_user_id().
   */
  asUser<T>(authUserId: string, fn: (tx: Tx) => Promise<T>): Promise<T>;
  ping(): Promise<void>;
}

export function createPool(options: {
  connectionString: string;
  max: number;
  caCert: string | null;
}): pg.Pool {
  return new pg.Pool({
    connectionString: options.connectionString,
    max: options.max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ...(options.caCert ? { ssl: { ca: options.caCert, rejectUnauthorized: true } } : {}),
  });
}

// Claims and SET ROLE do not prove which login owns the connection.
const runtimeRoleCheck = sql`exists (
  select 1 from pg_catalog.pg_roles
  where rolname = session_user and rolname = current_user
    and rolname = 'tushciemat_api'
    and rolcanlogin and not rolsuper and not rolbypassrls
)`;

function assertRuntimeRole(valid: unknown): void {
  if (valid !== true) {
    throw new Error(
      "Unsafe database role: expected tushciemat_api LOGIN NOSUPERUSER NOBYPASSRLS as session and current user",
    );
  }
}

export function createDatabase(pool: pg.Pool): Database {
  const db = drizzle(pool, { schema });

  return {
    pool,
    db,
    asUser(authUserId, fn) {
      const claims = JSON.stringify({ sub: authUserId, role: "tushciemat_api" });
      return db.transaction(async (tx) => {
        const result = await tx.execute<{ runtime_role_ok: boolean }>(
          sql`select ${runtimeRoleCheck} as runtime_role_ok,
            pg_catalog.set_config('request.jwt.claims', ${claims}, true),
            pg_catalog.set_config('statement_timeout', '15000', true)`,
        );
        assertRuntimeRole(result.rows[0]?.runtime_role_ok);
        return fn(tx);
      });
    },
    async ping() {
      const result = await db.execute<{ runtime_role_ok: boolean }>(
        sql`select ${runtimeRoleCheck} as runtime_role_ok`,
      );
      assertRuntimeRole(result.rows[0]?.runtime_role_ok);
    },
  };
}
