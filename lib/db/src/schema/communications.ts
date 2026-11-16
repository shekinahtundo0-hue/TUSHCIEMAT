import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  boolean,
} from "drizzle-orm/pg-core";
import { classesTable } from "./academics";
import { userProfilesTable } from "./identity";
import { schoolsTable } from "./schools";
import { studentsTable } from "./students";

export const announcementTargetingTypeEnum = pgEnum("announcement_targeting_type", [
  "all_school",
  "specific_classes",
  "specific_streams",
  "specific_roles",
  "specific_students",
]);

export const announcementStatusEnum = pgEnum("announcement_status", [
  "draft",
  "scheduled",
  "published",
  "archived",
]);

export const deliveryStatusEnum = pgEnum("delivery_status", [
  "pending",
  "delivered",
  "failed",
]);

export const announcementsExtendedTable = pgTable(
  "announcements_extended",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schoolsTable.id, { onDelete: "cascade" }),
    authorUserId: text("author_user_id")
      .notNull()
      .references(() => userProfilesTable.authUserId),
    title: text("title").notNull(),
    body: text("body").notNull(),
    targetingType: announcementTargetingTypeEnum("targeting_type")
      .notNull()
      .default("all_school"),
    targetingMetadata: jsonb("targeting_metadata")
      .$type<Record<string, unknown>>()
      .default({}),
    status: announcementStatusEnum("status").notNull().default("draft"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    scheduledPublishAt: timestamp("scheduled_publish_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    isPublished: boolean("is_published").notNull().default(false),
    totalRecipientsCount: integer("total_recipients_count"),
    deliveredCount: integer("delivered_count").default(0),
    readCount: integer("read_count").default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    index("announcements_extended_school_idx").on(table.schoolId),
    index("announcements_extended_published_idx")
      .on(table.schoolId, table.publishedAt.desc())
      .where(sql`${table.isPublished} = true`),
    index("announcements_extended_scheduled_idx")
      .on(table.schoolId, table.scheduledPublishAt)
      .where(sql`${table.status} = 'scheduled'`),
    check(
      "announcements_extended_status_check",
      sql`
        (${table.status} = 'published' AND ${table.isPublished} = true AND ${table.publishedAt} IS NOT NULL)
        OR (${table.status} = 'scheduled' AND ${table.isPublished} = false AND ${table.scheduledPublishAt} IS NOT NULL)
        OR (${table.status} = 'draft' AND ${table.isPublished} = false AND ${table.publishedAt} IS NULL)
        OR (${table.status} = 'archived' AND ${table.archivedAt} IS NOT NULL)
      `,
    ),
  ],
);

export const announcementAttachmentsTable = pgTable(
  "announcement_attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    announcementId: uuid("announcement_id")
      .notNull()
      .references(() => announcementsExtendedTable.id, { onDelete: "cascade" }),
    fileName: text("file_name").notNull(),
    fileType: text("file_type").notNull(),
    fileSizeBytes: integer("file_size_bytes").notNull(),
    filePath: text("file_path").notNull(),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("announcement_attachments_announcement_idx").on(table.announcementId),
    check("announcement_attachments_size_check", sql`${table.fileSizeBytes} > 0`),
  ],
);

export const announcementDeliveriesTable = pgTable(
  "announcement_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    announcementId: uuid("announcement_id")
      .notNull()
      .references(() => announcementsExtendedTable.id, { onDelete: "cascade" }),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schoolsTable.id, { onDelete: "cascade" }),
    recipientUserId: text("recipient_user_id")
      .notNull()
      .references(() => userProfilesTable.authUserId),
    deliveryStatus: deliveryStatusEnum("delivery_status")
      .notNull()
      .default("pending"),
    readAt: timestamp("read_at", { withTimezone: true }),
    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("announcement_deliveries_unique").on(
      table.announcementId,
      table.recipientUserId,
    ),
    index("announcement_deliveries_recipient_idx")
      .on(table.recipientUserId, table.createdAt.desc())
      .where(sql`${table.deliveryStatus} != 'failed'`),
    index("announcement_deliveries_announcement_idx").on(table.announcementId),
  ],
);

export const directMessagesTable = pgTable(
  "direct_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schoolsTable.id, { onDelete: "cascade" }),
    senderUserId: text("sender_user_id")
      .notNull()
      .references(() => userProfilesTable.authUserId),
    recipientUserId: text("recipient_user_id").references(
      () => userProfilesTable.authUserId,
    ),
    recipientClassId: uuid("recipient_class_id").references(
      () => classesTable.id,
      { onDelete: "cascade" },
    ),
    messageBody: text("message_body").notNull(),
    attachmentIds: jsonb("attachment_ids")
      .$type<string[]>()
      .default([]),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("direct_messages_sender_idx").on(table.senderUserId),
    index("direct_messages_recipient_idx")
      .on(table.recipientUserId)
      .where(sql`${table.recipientUserId} IS NOT NULL`),
    index("direct_messages_class_idx")
      .on(table.recipientClassId)
      .where(sql`${table.recipientClassId} IS NOT NULL`),
    check(
      "direct_messages_recipient_check",
      sql`(${table.recipientUserId} IS NOT NULL AND ${table.recipientClassId} IS NULL) OR (${table.recipientUserId} IS NULL AND ${table.recipientClassId} IS NOT NULL)`,
    ),
  ],
);

export type AnnouncementExtended = typeof announcementsExtendedTable.$inferSelect;
export type AnnouncementAttachment = typeof announcementAttachmentsTable.$inferSelect;
export type AnnouncementDelivery = typeof announcementDeliveriesTable.$inferSelect;
export type DirectMessage = typeof directMessagesTable.$inferSelect;
export type AnnouncementTargetingType = (typeof announcementTargetingTypeEnum.enumValues)[number];
export type AnnouncementStatus = (typeof announcementStatusEnum.enumValues)[number];
export type DeliveryStatus = (typeof deliveryStatusEnum.enumValues)[number];
