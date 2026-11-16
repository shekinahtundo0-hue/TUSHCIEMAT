import type { Request, Response } from "express";
import { and, eq, sql } from "drizzle-orm";
import type { SchoolCapability } from "@workspace/api-zod";
import type { ZodType, ZodTypeDef } from "zod";
import {
  auditLogsTable,
  schoolMembershipsTable,
  type SchoolRole,
  type UserProfile,
} from "@workspace/db/schema";
import type { Database, Tx } from "./database";
import { badRequest, forbidden, unauthorized } from "./errors";
import { hasAny } from "./roles";

declare global {
  namespace Express {
    interface Locals {
      userId?: string;
      profile?: UserProfile;
    }
  }
}

export interface SchoolContext {
  userId: string;
  schoolId: string;
  roles: SchoolRole[];
  capabilities: SchoolCapability[];
}

type SchoolAccess = readonly SchoolRole[] | {
  roles: readonly SchoolRole[];
  capability: SchoolCapability | readonly SchoolCapability[];
  scopedRoles?: readonly SchoolRole[];
};

export async function schoolCapabilities(tx: Tx, schoolId: string): Promise<SchoolCapability[]> {
  const result = await tx.execute<{ capability: SchoolCapability }>(sql`
    select capability::text as capability
    from unnest(enum_range(null::public.school_capability)) capability
    where app_private.has_school_capability(${schoolId}::uuid, capability::text)
  `);
  return result.rows.map((row) => row.capability);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function currentUserId(res: Response): string {
  const userId = res.locals.userId;
  if (!userId) throw unauthorized();
  return userId;
}

export async function inSchool<T>(
  database: Database,
  req: Request,
  res: Response,
  access: SchoolAccess,
  fn: (tx: Tx, ctx: SchoolContext) => Promise<T>,
): Promise<T> {
  const userId = currentUserId(res);
  const schoolId = req.get("x-school-id");
  if (!schoolId) throw badRequest("Choose a school first (X-School-Id header).", "school_required");
  if (!isUuid(schoolId)) throw badRequest("X-School-Id must be a school id.", "school_required");

  return database.asUser(userId, async (tx) => {
    const rows = await tx
      .select({ role: schoolMembershipsTable.role })
      .from(schoolMembershipsTable)
      .where(
        and(
          eq(schoolMembershipsTable.schoolId, schoolId),
          eq(schoolMembershipsTable.authUserId, userId),
          eq(schoolMembershipsTable.status, "active"),
        ),
      );
    const roles = rows.map((row) => row.role);
    if (roles.length === 0) throw forbidden("You do not have access to this school.");
    const allowed = "roles" in access ? access.roles : access;
    if (!hasAny(roles, allowed)) throw forbidden();
    const capabilities = await schoolCapabilities(tx, schoolId);
    if ("capability" in access) {
      const required = typeof access.capability === "string" ? [access.capability] : access.capability;
      if (!required.some((capability) => capabilities.includes(capability)) && !hasAny(roles, access.scopedRoles ?? [])) {
        throw forbidden("Your school owner has not granted this management capability.");
      }
    }
    return fn(tx, { userId, schoolId, roles, capabilities });
  });
}

export async function audit(
  tx: Tx,
  ctx: SchoolContext,
  action: string,
  entityType: string,
  entityId: string | null,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await tx.insert(auditLogsTable).values({
    schoolId: ctx.schoolId,
    actorUserId: ctx.userId,
    action,
    entityType,
    entityId,
    metadata,
  });
}

/** Validates the response against the OpenAPI schema, dropping unlisted fields. */
export function send<T>(
  res: Response,
  schema: ZodType<T, ZodTypeDef, unknown>,
  data: unknown,
  status = 200,
): void {
  res.status(status).json(schema.parse(data));
}
