CREATE TYPE "public"."school_capability" AS ENUM('students.manage', 'academics.manage', 'attendance.manage', 'people.manage', 'requests.review', 'settings.manage', 'announcements.manage', 'assessments.manage', 'results.publish', 'resources.manage', 'records.delete');--> statement-breakpoint
CREATE TABLE "membership_capabilities" (
	"membership_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"capability" "school_capability" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_capabilities_membership_capability_pk" PRIMARY KEY("membership_id","capability")
);
--> statement-breakpoint
ALTER TABLE "membership_capabilities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "membership_capabilities" ADD CONSTRAINT "membership_capabilities_membership_id_school_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."school_memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_capabilities" ADD CONSTRAINT "membership_capabilities_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "membership_capabilities_school_idx" ON "membership_capabilities" USING btree ("school_id","membership_id");