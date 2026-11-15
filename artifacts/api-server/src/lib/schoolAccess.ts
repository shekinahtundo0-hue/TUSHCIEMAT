import { and, asc, eq, sql } from "drizzle-orm";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { NodePgTransaction } from "drizzle-orm/node-postgres";
import { db } from "@workspace/db";
import * as schema from "@workspace/db/schema";
import {
  schoolMembershipsTable,
  type SchoolMembership,
  type SchoolRole,
} from "@workspace/db";

type Transaction = NodePgTransaction<
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

export class SchoolAccessError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 403) {
    super(message);
    this.name = "SchoolAccessError";
    this.statusCode = statusCode;
  }
}

export async function setUserContext(
  tx: Transaction,
  clerkUserId: string,
): Promise<void> {
  await tx.execute(
    sql`select set_config('app.current_user_id', ${clerkUserId}, true)`,
  );
}

export async function withSchoolAccess<T>(
  clerkUserId: string,
  allowedRoles: readonly SchoolRole[],
  operation: (
    tx: Transaction,
    membership: SchoolMembership,
  ) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await setUserContext(tx, clerkUserId);
    const [membership] = await tx
      .select()
      .from(schoolMembershipsTable)
      .where(
        and(
          eq(schoolMembershipsTable.clerkUserId, clerkUserId),
          eq(schoolMembershipsTable.status, "active"),
        ),
      )
      .orderBy(asc(schoolMembershipsTable.createdAt))
      .limit(1);

    if (!membership) {
      throw new SchoolAccessError(
        "Create or join a school workspace before continuing.",
        403,
      );
    }

    const mayReviewMemberships = [
      "owner",
      "school_admin",
      "principal",
      "academic_admin",
    ].includes(membership.role);

    await tx.execute(
      sql`select set_config('app.current_school_id', ${membership.schoolId}, true)`,
    );
    await tx.execute(
      sql`select set_config('app.school_member_admin', ${String(mayReviewMemberships)}, true)`,
    );

    if (!allowedRoles.includes(membership.role)) {
      throw new SchoolAccessError(
        "Your school role does not allow this action.",
      );
    }

    return operation(tx, membership);
  });
}

export async function writeAuditLog(
  tx: Transaction,
  schoolId: string,
  clerkUserId: string,
  action: string,
  entityType: string,
  entityId: string | null,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await tx.insert(schema.auditLogsTable).values({
    schoolId,
    actorClerkUserId: clerkUserId,
    action,
    entityType,
    entityId,
    metadata,
  });
}

export type { Transaction };
