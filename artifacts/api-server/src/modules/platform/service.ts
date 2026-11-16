import { sql } from "drizzle-orm";
import type { Tx } from "../../lib/database";

export async function platformSchools(tx: Tx) {
  const result = await tx.execute<{
    id: string;
    name: string;
    category: string;
    county: string | null;
    created_at: string | Date;
    active_members: string | number;
    active_students: string | number;
  }>(sql`select * from app_private.platform_school_summaries()`);
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    category: row.category,
    county: row.county,
    createdAt: new Date(row.created_at),
    activeMembers: Number(row.active_members),
    activeStudents: Number(row.active_students),
  }));
}
