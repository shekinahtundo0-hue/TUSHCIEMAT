-- Extend capabilities enum to include new module capabilities
-- This is a safe operation since enums only grow in Postgres

ALTER TYPE public.school_capability ADD VALUE 'staff.manage' BEFORE 'records.delete';
ALTER TYPE public.school_capability ADD VALUE 'workload.manage' BEFORE 'records.delete';
ALTER TYPE public.school_capability ADD VALUE 'communications.manage' BEFORE 'records.delete';
--> statement-breakpoint
