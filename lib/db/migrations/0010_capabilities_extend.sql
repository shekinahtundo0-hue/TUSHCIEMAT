-- Extend capabilities enum to include new module capabilities
-- This is a safe operation since enums only grow in Postgres

ALTER TYPE public.school_capability ADD VALUE 'staff.manage' BEFORE 'records.delete';
ALTER TYPE public.school_capability ADD VALUE 'workload.manage' BEFORE 'records.delete';
ALTER TYPE public.school_capability ADD VALUE 'communications.manage' BEFORE 'records.delete';

-- Update audit log for this structural change
INSERT INTO public.audit_logs (school_id, actor_user_id, action, entity_type, metadata)
SELECT 
  id,
  (SELECT auth_user_id FROM public.user_profiles WHERE platform_role = 'platform_admin' LIMIT 1),
  'schema.capabilities_extended',
  'enum',
  jsonb_build_object('capabilities_added', jsonb_build_array('staff.manage', 'workload.manage', 'communications.manage'))
FROM public.schools
ON CONFLICT DO NOTHING;

--> statement-breakpoint
