CREATE TABLE "announcements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"author_user_id" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"auth_user_id" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"entity_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "school_join_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"auth_user_id" text NOT NULL,
	"requested_role" "school_role" NOT NULL,
	"school_name" text NOT NULL,
	"applicant_name" text NOT NULL,
	"applicant_email" text NOT NULL,
	"applicant_details" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_by_user_id" text,
	"reviewed_at" timestamp with time zone,
	"rejection_reason" text,
	"student_id" uuid,
	"guardian_id" uuid,
	CONSTRAINT "school_join_requests_role_check" CHECK ("school_join_requests"."requested_role" IN ('student', 'teacher', 'school_admin', 'parent')),
	CONSTRAINT "school_join_requests_status_check" CHECK ("school_join_requests"."status" IN ('pending', 'approved', 'rejected')),
	CONSTRAINT "school_join_requests_details_check" CHECK (jsonb_typeof("school_join_requests"."applicant_details") = 'object' AND octet_length("school_join_requests"."applicant_details"::text) <= 8000),
	CONSTRAINT "school_join_requests_review_check" CHECK (
      ("school_join_requests"."status" = 'pending' AND "school_join_requests"."reviewed_by_user_id" IS NULL AND "school_join_requests"."reviewed_at" IS NULL
        AND "school_join_requests"."rejection_reason" IS NULL AND "school_join_requests"."student_id" IS NULL AND "school_join_requests"."guardian_id" IS NULL)
      OR ("school_join_requests"."status" = 'approved' AND "school_join_requests"."reviewed_by_user_id" IS NOT NULL AND "school_join_requests"."reviewed_at" IS NOT NULL
        AND "school_join_requests"."reviewed_by_user_id" <> "school_join_requests"."auth_user_id" AND "school_join_requests"."rejection_reason" IS NULL
        AND (("school_join_requests"."requested_role" = 'student' AND "school_join_requests"."student_id" IS NOT NULL AND "school_join_requests"."guardian_id" IS NULL)
          OR ("school_join_requests"."requested_role" = 'parent' AND "school_join_requests"."guardian_id" IS NOT NULL AND "school_join_requests"."student_id" IS NULL)
          OR ("school_join_requests"."requested_role" IN ('teacher', 'school_admin') AND "school_join_requests"."student_id" IS NULL AND "school_join_requests"."guardian_id" IS NULL)))
      OR ("school_join_requests"."status" = 'rejected' AND "school_join_requests"."reviewed_by_user_id" IS NOT NULL AND "school_join_requests"."reviewed_at" IS NOT NULL
        AND "school_join_requests"."reviewed_by_user_id" <> "school_join_requests"."auth_user_id" AND "school_join_requests"."rejection_reason" IS NOT NULL
        AND char_length(btrim("school_join_requests"."rejection_reason")) BETWEEN 3 AND 500
        AND "school_join_requests"."student_id" IS NULL AND "school_join_requests"."guardian_id" IS NULL)
    )
);
--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "country" text DEFAULT 'Kenya' NOT NULL;--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "town" text;--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "logo_url" text;--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "contact_email" text;--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "contact_phone" text;--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "website" text;--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "verification_status" text DEFAULT 'unverified' NOT NULL;--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "discoverable" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_author_user_id_user_profiles_auth_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."user_profiles"("auth_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_auth_user_id_user_profiles_auth_user_id_fk" FOREIGN KEY ("auth_user_id") REFERENCES "public"."user_profiles"("auth_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_join_requests" ADD CONSTRAINT "school_join_requests_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_join_requests" ADD CONSTRAINT "school_join_requests_auth_user_id_user_profiles_auth_user_id_fk" FOREIGN KEY ("auth_user_id") REFERENCES "public"."user_profiles"("auth_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_join_requests" ADD CONSTRAINT "school_join_requests_reviewed_by_user_id_user_profiles_auth_user_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."user_profiles"("auth_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_join_requests" ADD CONSTRAINT "school_join_requests_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_join_requests" ADD CONSTRAINT "school_join_requests_guardian_id_guardians_id_fk" FOREIGN KEY ("guardian_id") REFERENCES "public"."guardians"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "announcements_school_date_idx" ON "announcements" USING btree ("school_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notifications_recipient_date_idx" ON "notifications" USING btree ("auth_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "school_join_requests_one_pending" ON "school_join_requests" USING btree ("school_id","auth_user_id","requested_role") WHERE "school_join_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "school_join_requests_school_date_idx" ON "school_join_requests" USING btree ("school_id","submitted_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "school_join_requests_user_date_idx" ON "school_join_requests" USING btree ("auth_user_id","submitted_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "schools_directory_name_idx" ON "schools" USING btree (lower(btrim(regexp_replace("name", '[[:space:]]+', ' ', 'g'))),"id") WHERE "schools"."discoverable";--> statement-breakpoint
ALTER TABLE "schools" ADD CONSTRAINT "schools_verification_status_check" CHECK ("schools"."verification_status" IN ('unverified', 'verified'));