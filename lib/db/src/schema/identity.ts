import {
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const platformRoleEnum = pgEnum("platform_role", [
  "platform_admin",
  "platform_support",
]);

export const profileStatusEnum = pgEnum("profile_status", [
  "active",
  "disabled",
  "deleted",
]);

// One row per Firebase user (uid). auth_user_id is the only identity key; email is informational.
export const userProfilesTable = pgTable(
  "user_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    authUserId: text("auth_user_id").notNull().unique("user_profiles_auth_user_unique"),
    fullName: text("full_name"),
    email: text("email"),
    imageUrl: text("image_url"),
    status: profileStatusEnum("status").notNull().default("active"),
    platformRole: platformRoleEnum("platform_role"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
);

export type UserProfile = typeof userProfilesTable.$inferSelect;
export type PlatformRole = (typeof platformRoleEnum.enumValues)[number];
