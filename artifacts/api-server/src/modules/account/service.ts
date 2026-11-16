import { and, asc, eq, sql } from "drizzle-orm";
import type { SchoolCapability } from "@workspace/api-zod";
import {
  schoolMembershipsTable,
  schoolsTable,
  userProfilesTable,
  type SchoolRole,
  type UserProfile,
} from "@workspace/db/schema";
import type { Database, Tx } from "../../lib/database";
import type { AppDeps } from "../../lib/deps";
import { schoolCapabilities } from "../../lib/context";
import { forbidden } from "../../lib/errors";
import type { VerifiedProfile } from "../../lib/identity";

const REFRESH_AFTER_MS = 15 * 60 * 1000;

async function readOwnProfile(tx: Tx, authUserId: string): Promise<UserProfile | undefined> {
  const [profile] = await tx
    .select()
    .from(userProfilesTable)
    .where(eq(userProfilesTable.authUserId, authUserId));
  return profile;
}

export function syncProfile(
  database: Database,
  authUserId: string,
  profile: VerifiedProfile,
): Promise<UserProfile> {
  return database.asUser(authUserId, async (tx) => {
    await tx.execute(
      sql`select app_private.sync_user_profile(${authUserId}, ${profile.fullName}, ${profile.email}, ${profile.imageUrl})`,
    );
    const saved = await readOwnProfile(tx, authUserId);
    if (!saved) throw new Error("profile sync returned no row");
    return saved;
  });
}

function differs(stored: UserProfile, verified: VerifiedProfile): boolean {
  return (
    stored.fullName !== verified.fullName ||
    stored.email !== verified.email ||
    stored.imageUrl !== verified.imageUrl
  );
}

/**
 * Returns the caller's profile, creating or refreshing it from the verified
 * token claims when it is missing, stale or out of date.
 */
export async function ensureProfile(
  deps: AppDeps,
  authUserId: string,
  verified: VerifiedProfile,
): Promise<UserProfile> {
  const existing = await deps.database.asUser(authUserId, (tx) => readOwnProfile(tx, authUserId));
  if (existing && existing.status !== "active") throw forbidden("This account is not active.");
  const stale =
    !existing ||
    differs(existing, verified) ||
    !existing.lastSeenAt ||
    Date.now() - existing.lastSeenAt.getTime() > REFRESH_AFTER_MS;

  const profile = stale ? await syncProfile(deps.database, authUserId, verified) : existing;
  if (profile.status !== "active") throw forbidden("This account is not active.");
  return profile;
}

export async function getMe(database: Database, profile: UserProfile) {
  const schools = await database.asUser(profile.authUserId, async (tx) => {
    const rows = await tx
      .select({
        schoolId: schoolsTable.id,
        schoolName: schoolsTable.name,
        role: schoolMembershipsTable.role,
      })
      .from(schoolMembershipsTable)
      .innerJoin(schoolsTable, eq(schoolsTable.id, schoolMembershipsTable.schoolId))
      .where(
        and(
          eq(schoolMembershipsTable.authUserId, profile.authUserId),
          eq(schoolMembershipsTable.status, "active"),
        ),
      )
      .orderBy(asc(schoolsTable.name), asc(schoolMembershipsTable.createdAt));

    const bySchool = new Map<
      string,
      { schoolId: string; schoolName: string; roles: SchoolRole[]; capabilities: SchoolCapability[] }
    >();
    for (const row of rows) {
      const entry =
        bySchool.get(row.schoolId) ??
        { schoolId: row.schoolId, schoolName: row.schoolName, roles: [], capabilities: [] };
      entry.roles.push(row.role);
      bySchool.set(row.schoolId, entry);
    }
    for (const entry of bySchool.values()) {
      entry.capabilities = await schoolCapabilities(tx, entry.schoolId);
    }
    return [...bySchool.values()];
  });

  return {
    authUserId: profile.authUserId,
    fullName: profile.fullName,
    email: profile.email,
    platformRole: profile.platformRole,
    schools,
  };
}
