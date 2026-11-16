-- Tushciemat security layer: least-privilege API role, identity helpers,
-- role-aware row-level security, integrity triggers and anti-escalation guards.
--
-- Identity: the API verifies the Firebase ID token, then sets the
-- transaction-local setting request.jwt.claims = {"sub": "<firebase uid>"}.
-- This is the same setting Supabase's Data API populates from a verified JWT,
-- so app_private.current_user_id() behaves identically on both paths.
-- Policies are scoped TO tushciemat_api; anon/authenticated get no access.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tushciemat_api') THEN
    CREATE ROLE tushciemat_api NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  END IF;
END
$$;
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS app_private;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC;
GRANT USAGE ON SCHEMA app_private TO tushciemat_api;
GRANT USAGE ON SCHEMA public TO tushciemat_api;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Identity and membership helpers. SECURITY DEFINER helpers read membership
-- tables without recursing through RLS; every one pins search_path.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.current_user_id()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_private.has_school_role(p_school_id uuid, p_roles public.school_role[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.school_memberships m
    JOIN public.user_profiles p ON p.auth_user_id = m.auth_user_id
    WHERE m.school_id = p_school_id
      AND m.auth_user_id = app_private.current_user_id()
      AND m.status = 'active'
      AND p.status = 'active'
      AND m.role = ANY (p_roles)
  )
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_private.is_school_member(p_school_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.school_memberships m
    JOIN public.user_profiles p ON p.auth_user_id = m.auth_user_id
    WHERE m.school_id = p_school_id
      AND m.auth_user_id = app_private.current_user_id()
      AND m.status = 'active'
      AND p.status = 'active'
  )
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_private.school_has_members(p_school_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM public.school_memberships m WHERE m.school_id = p_school_id)
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_private.can_bootstrap_school(p_school_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.schools s
    WHERE s.id = p_school_id
      AND s.created_by_user_id = app_private.current_user_id()
  )
  AND NOT app_private.school_has_members(p_school_id)
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_private.teaches_class(p_class_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_class_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.class_teacher_assignments a
    JOIN public.school_memberships m
      ON m.school_id = a.school_id
     AND m.auth_user_id = a.teacher_user_id
     AND m.role = 'teacher'
     AND m.status = 'active'
    JOIN public.user_profiles p ON p.auth_user_id = m.auth_user_id AND p.status = 'active'
    WHERE a.class_id = p_class_id
      AND a.teacher_user_id = app_private.current_user_id()
  )
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_private.is_guardian_of(p_student_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.student_guardians sg
    JOIN public.guardians g ON g.id = sg.guardian_id
    JOIN public.school_memberships m
      ON m.school_id = g.school_id
     AND m.auth_user_id = g.auth_user_id
     AND m.role = 'parent'
     AND m.status = 'active'
    JOIN public.user_profiles p ON p.auth_user_id = m.auth_user_id AND p.status = 'active'
    WHERE sg.student_id = p_student_id
      AND g.auth_user_id = app_private.current_user_id()
  )
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_private.is_student_self(p_student_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.students s
    JOIN public.school_memberships m
      ON m.school_id = s.school_id
     AND m.auth_user_id = s.auth_user_id
     AND m.role = 'student'
     AND m.status = 'active'
    JOIN public.user_profiles p ON p.auth_user_id = m.auth_user_id AND p.status = 'active'
    WHERE s.id = p_student_id
      AND s.auth_user_id = app_private.current_user_id()
  )
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_private.is_guardian_account(p_guardian_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.guardians g
    WHERE g.id = p_guardian_id
      AND g.auth_user_id = app_private.current_user_id()
  )
$$;
--> statement-breakpoint

-- Staff may see the profile (name, email) of people who belong to their school.
CREATE OR REPLACE FUNCTION app_private.is_visible_profile(p_user_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.school_memberships target
    JOIN public.school_memberships viewer
      ON viewer.school_id = target.school_id
     AND viewer.auth_user_id = app_private.current_user_id()
     AND viewer.status = 'active'
     AND viewer.role IN ('owner', 'school_admin', 'principal', 'academic_admin')
    WHERE target.auth_user_id = p_user_id
  )
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_private.is_platform_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles p
    WHERE p.auth_user_id = app_private.current_user_id()
      AND p.status = 'active'
      AND p.platform_role IS NOT NULL
  )
$$;
--> statement-breakpoint

-- Guard triggers enforce rules only for request-scoped roles. Trusted
-- SECURITY DEFINER routines and operators (the schema owner) are exempt.
CREATE OR REPLACE FUNCTION app_private.is_request_role()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT current_user IN ('tushciemat_api', 'authenticated', 'anon')
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Trusted routines.
-- ---------------------------------------------------------------------------

-- Creates or refreshes a profile from claims in a verified Firebase ID token.
-- platform_role is never touched here; it is granted by an operator only.
CREATE OR REPLACE FUNCTION app_private.sync_user_profile(
  p_user_id text,
  p_full_name text,
  p_email text,
  p_image_url text
)
RETURNS public.user_profiles
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  result public.user_profiles;
BEGIN
  IF p_user_id IS NULL OR p_user_id !~ '^[A-Za-z0-9_-]{1,128}$' THEN
    RAISE EXCEPTION 'invalid user id' USING ERRCODE = '22023';
  END IF;
  IF p_user_id IS DISTINCT FROM app_private.current_user_id() THEN
    RAISE EXCEPTION 'a profile can only be synced for the verified identity' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.user_profiles (auth_user_id, full_name, email, image_url, last_seen_at)
  VALUES (p_user_id, p_full_name, lower(p_email), p_image_url, now())
  ON CONFLICT (auth_user_id) DO UPDATE
    SET full_name = EXCLUDED.full_name,
        email = EXCLUDED.email,
        image_url = EXCLUDED.image_url,
        last_seen_at = now()
  RETURNING * INTO result;
  RETURN result;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_private.mark_user_deleted(p_user_id text)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_user_id IS DISTINCT FROM app_private.current_user_id() THEN
    RAISE EXCEPTION 'only the verified identity can be marked deleted' USING ERRCODE = '42501';
  END IF;
  UPDATE public.user_profiles
     SET status = 'deleted', deleted_at = now(), email = NULL, full_name = NULL, image_url = NULL
   WHERE auth_user_id = p_user_id;
  UPDATE public.school_memberships
     SET status = 'suspended'
   WHERE auth_user_id = p_user_id;
END;
$$;
--> statement-breakpoint

-- Accepts an invitation for the signed-in user. The token is the bearer
-- secret; the verified account email must also match the invited address.
CREATE OR REPLACE FUNCTION app_private.accept_invitation(p_token_hash text)
RETURNS TABLE (membership_id uuid, school_id uuid, role public.school_role)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  actor text := app_private.current_user_id();
  profile public.user_profiles;
  invite public.invitations;
  new_membership_id uuid;
BEGIN
  IF actor IS NULL THEN
    RAISE EXCEPTION 'sign in is required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO profile FROM public.user_profiles WHERE auth_user_id = actor;
  IF profile.id IS NULL OR profile.status <> 'active' THEN
    RAISE EXCEPTION 'account is not active' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO invite FROM public.invitations i
   WHERE i.token_hash = p_token_hash
   FOR UPDATE;
  IF invite.id IS NULL OR invite.status <> 'pending' OR invite.expires_at <= now() THEN
    RAISE EXCEPTION 'invitation is not valid' USING ERRCODE = 'P0002';
  END IF;
  IF invite.invited_by_user_id = actor THEN
    RAISE EXCEPTION 'you cannot accept your own invitation' USING ERRCODE = '42501';
  END IF;
  IF profile.email IS NULL OR profile.email <> invite.email THEN
    RAISE EXCEPTION 'invitation was sent to a different email address' USING ERRCODE = '42501';
  END IF;

  IF invite.role = 'student' THEN
    UPDATE public.students s SET auth_user_id = actor
     WHERE s.id = invite.student_id AND s.school_id = invite.school_id
       AND (s.auth_user_id IS NULL OR s.auth_user_id = actor);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'student record is already linked to another account' USING ERRCODE = '23505';
    END IF;
  ELSIF invite.role = 'parent' THEN
    UPDATE public.guardians g SET auth_user_id = actor
     WHERE g.id = invite.guardian_id AND g.school_id = invite.school_id
       AND (g.auth_user_id IS NULL OR g.auth_user_id = actor);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'guardian record is already linked to another account' USING ERRCODE = '23505';
    END IF;
  END IF;

  INSERT INTO public.school_memberships (school_id, auth_user_id, role, status, created_by_user_id)
  VALUES (invite.school_id, actor, invite.role, 'active', invite.invited_by_user_id)
  ON CONFLICT (school_id, auth_user_id, role) DO UPDATE SET status = 'active'
  RETURNING id INTO new_membership_id;

  UPDATE public.invitations
     SET status = 'accepted', accepted_by_user_id = actor, accepted_at = now()
   WHERE id = invite.id;

  INSERT INTO public.audit_logs (school_id, actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (invite.school_id, actor, 'invitation.accepted', 'invitation', invite.id,
          jsonb_build_object('role', invite.role, 'membershipId', new_membership_id));

  RETURN QUERY SELECT new_membership_id, invite.school_id, invite.role;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_private.platform_school_summaries()
RETURNS TABLE (
  id uuid,
  name text,
  category public.school_category,
  county text,
  created_at timestamptz,
  active_members bigint,
  active_students bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
BEGIN
  IF NOT app_private.is_platform_staff() THEN
    RAISE EXCEPTION 'platform access is required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT s.id, s.name, s.category, s.county, s.created_at,
      (SELECT count(DISTINCT m.auth_user_id) FROM public.school_memberships m
        WHERE m.school_id = s.id AND m.status = 'active'),
      (SELECT count(*) FROM public.students st
        WHERE st.school_id = s.id AND st.status = 'active')
    FROM public.schools s
    ORDER BY s.created_at DESC;
END;
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Integrity triggers (same-school relationships), independent of the API.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER user_profiles_updated_at BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();
CREATE TRIGGER schools_updated_at BEFORE UPDATE ON public.schools
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();
CREATE TRIGGER school_memberships_updated_at BEFORE UPDATE ON public.school_memberships
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();
CREATE TRIGGER students_updated_at BEFORE UPDATE ON public.students
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();
CREATE TRIGGER guardians_updated_at BEFORE UPDATE ON public.guardians
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();
CREATE TRIGGER attendance_records_updated_at BEFORE UPDATE ON public.attendance_records
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_private.enforce_term_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.academic_years y
    WHERE y.id = NEW.academic_year_id
      AND y.school_id = NEW.school_id
      AND NEW.starts_on >= y.starts_on
      AND NEW.ends_on <= y.ends_on
  ) THEN
    RAISE EXCEPTION 'term must fall within an academic year of the same school' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER terms_same_school_year BEFORE INSERT OR UPDATE ON public.terms
  FOR EACH ROW EXECUTE FUNCTION app_private.enforce_term_tenant();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_private.enforce_class_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.academic_years y
    WHERE y.id = NEW.academic_year_id AND y.school_id = NEW.school_id
  ) THEN
    RAISE EXCEPTION 'class academic year must belong to the same school' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER school_classes_same_school_year BEFORE INSERT OR UPDATE OF school_id, academic_year_id ON public.school_classes
  FOR EACH ROW EXECUTE FUNCTION app_private.enforce_class_tenant();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_private.enforce_assignment_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.school_classes c
    WHERE c.id = NEW.class_id AND c.school_id = NEW.school_id
  ) THEN
    RAISE EXCEPTION 'class must belong to the same school' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.school_memberships m
    WHERE m.school_id = NEW.school_id
      AND m.auth_user_id = NEW.teacher_user_id
      AND m.role = 'teacher'
      AND m.status = 'active'
  ) THEN
    RAISE EXCEPTION 'assigned person must be an active teacher at this school' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER class_teacher_assignments_same_school BEFORE INSERT OR UPDATE ON public.class_teacher_assignments
  FOR EACH ROW EXECUTE FUNCTION app_private.enforce_assignment_tenant();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_private.enforce_student_class_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.class_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.school_classes c
    WHERE c.id = NEW.class_id AND c.school_id = NEW.school_id
  ) THEN
    RAISE EXCEPTION 'student class must belong to the same school' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER students_same_school_class BEFORE INSERT OR UPDATE OF school_id, class_id ON public.students
  FOR EACH ROW EXECUTE FUNCTION app_private.enforce_student_class_tenant();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_private.enforce_student_guardian_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.students s WHERE s.id = NEW.student_id AND s.school_id = NEW.school_id
  ) OR NOT EXISTS (
    SELECT 1 FROM public.guardians g WHERE g.id = NEW.guardian_id AND g.school_id = NEW.school_id
  ) THEN
    RAISE EXCEPTION 'student and guardian must belong to the same school' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER student_guardians_same_school BEFORE INSERT OR UPDATE ON public.student_guardians
  FOR EACH ROW EXECUTE FUNCTION app_private.enforce_student_guardian_tenant();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_private.enforce_attendance_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.school_classes c
    WHERE c.id = NEW.class_id AND c.school_id = NEW.school_id
  ) OR NOT EXISTS (
    SELECT 1 FROM public.students s
    WHERE s.id = NEW.student_id
      AND s.school_id = NEW.school_id
      AND s.class_id = NEW.class_id
      AND s.status = 'active'
  ) THEN
    RAISE EXCEPTION 'attendance student and class must belong to the same school' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER attendance_same_school BEFORE INSERT OR UPDATE OF school_id, class_id, student_id ON public.attendance_records
  FOR EACH ROW EXECUTE FUNCTION app_private.enforce_attendance_tenant();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_private.enforce_invitation_links()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.student_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.students s WHERE s.id = NEW.student_id AND s.school_id = NEW.school_id
  ) THEN
    RAISE EXCEPTION 'invited student must belong to the same school' USING ERRCODE = '23514';
  END IF;
  IF NEW.guardian_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.guardians g WHERE g.id = NEW.guardian_id AND g.school_id = NEW.school_id
  ) THEN
    RAISE EXCEPTION 'invited guardian must belong to the same school' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER invitations_same_school BEFORE INSERT ON public.invitations
  FOR EACH ROW EXECUTE FUNCTION app_private.enforce_invitation_links();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Anti-escalation guards (SECURITY INVOKER so current_user is the caller).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.guard_membership_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  actor text := app_private.current_user_id();
  bootstrap boolean;
BEGIN
  IF NOT app_private.is_request_role() THEN
    RETURN NEW;
  END IF;
  IF actor IS NULL THEN
    RAISE EXCEPTION 'sign in is required' USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' THEN
    bootstrap := NEW.auth_user_id = actor AND NEW.role = 'owner'
                 AND app_private.can_bootstrap_school(NEW.school_id);
    IF NEW.auth_user_id = actor AND NOT bootstrap THEN
      RAISE EXCEPTION 'you cannot grant yourself a school role' USING ERRCODE = '42501';
    END IF;
    IF NEW.role = 'owner' AND NOT bootstrap
       AND NOT app_private.has_school_role(NEW.school_id, ARRAY['owner']::public.school_role[]) THEN
      RAISE EXCEPTION 'only an owner can grant the owner role' USING ERRCODE = '42501';
    END IF;
    NEW.created_by_user_id := actor;
    RETURN NEW;
  END IF;

  IF NEW.school_id <> OLD.school_id OR NEW.auth_user_id <> OLD.auth_user_id THEN
    RAISE EXCEPTION 'membership school and person cannot change' USING ERRCODE = '42501';
  END IF;
  IF OLD.auth_user_id = actor AND (NEW.role <> OLD.role OR NEW.status <> OLD.status) THEN
    RAISE EXCEPTION 'you cannot change your own role or access' USING ERRCODE = '42501';
  END IF;
  IF (NEW.role = 'owner' OR OLD.role = 'owner')
     AND (NEW.role <> OLD.role OR NEW.status <> OLD.status)
     AND NOT app_private.has_school_role(NEW.school_id, ARRAY['owner']::public.school_role[]) THEN
    RAISE EXCEPTION 'only an owner can change an owner membership' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER school_memberships_guard BEFORE INSERT OR UPDATE ON public.school_memberships
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_membership_change();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_private.guard_invitation_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT app_private.is_request_role() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending' OR NEW.accepted_by_user_id IS NOT NULL
       OR NEW.accepted_at IS NOT NULL OR NEW.revoked_at IS NOT NULL THEN
      RAISE EXCEPTION 'new invitations must be pending' USING ERRCODE = '42501';
    END IF;
    IF NEW.role = 'owner'
       AND NOT app_private.has_school_role(NEW.school_id, ARRAY['owner']::public.school_role[]) THEN
      RAISE EXCEPTION 'only an owner can invite another owner' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT (OLD.status = 'pending' AND NEW.status = 'revoked') THEN
    RAISE EXCEPTION 'only pending invitations can be revoked' USING ERRCODE = '42501';
  END IF;
  NEW.revoked_at := now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER invitations_guard BEFORE INSERT OR UPDATE ON public.invitations
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_invitation_change();
--> statement-breakpoint

-- Account links on students/guardians are set only by accept_invitation.
CREATE OR REPLACE FUNCTION app_private.guard_account_link()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF app_private.is_request_role() AND NEW.auth_user_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id) THEN
    RAISE EXCEPTION 'accounts are linked only through an accepted invitation' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER students_account_link_guard BEFORE INSERT OR UPDATE ON public.students
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_account_link();
CREATE TRIGGER guardians_account_link_guard BEFORE INSERT OR UPDATE ON public.guardians
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_account_link();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Row-level security. Not FORCEd: the schema owner (migrations and the
-- SECURITY DEFINER routines above) is trusted; the API role is not.
-- ---------------------------------------------------------------------------

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schools ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academic_years ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_teacher_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guardians ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_guardians ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY user_profiles_select ON public.user_profiles FOR SELECT TO tushciemat_api
  USING (auth_user_id = (SELECT app_private.current_user_id())
         OR app_private.is_visible_profile(auth_user_id));
--> statement-breakpoint

CREATE POLICY schools_select ON public.schools FOR SELECT TO tushciemat_api
  USING (app_private.is_school_member(id)
         OR (created_by_user_id = (SELECT app_private.current_user_id())
             AND NOT app_private.school_has_members(id)));
CREATE POLICY schools_insert ON public.schools FOR INSERT TO tushciemat_api
  WITH CHECK (created_by_user_id = (SELECT app_private.current_user_id()));
CREATE POLICY schools_update ON public.schools FOR UPDATE TO tushciemat_api
  USING (app_private.has_school_role(id, ARRAY['owner', 'school_admin']::public.school_role[]))
  WITH CHECK (app_private.has_school_role(id, ARRAY['owner', 'school_admin']::public.school_role[]));
--> statement-breakpoint

CREATE POLICY school_memberships_select ON public.school_memberships FOR SELECT TO tushciemat_api
  USING (auth_user_id = (SELECT app_private.current_user_id())
         OR app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[]));
CREATE POLICY school_memberships_insert ON public.school_memberships FOR INSERT TO tushciemat_api
  WITH CHECK (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin']::public.school_role[])
              OR (auth_user_id = (SELECT app_private.current_user_id())
                  AND role = 'owner'
                  AND app_private.can_bootstrap_school(school_id)));
CREATE POLICY school_memberships_update ON public.school_memberships FOR UPDATE TO tushciemat_api
  USING (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin']::public.school_role[]))
  WITH CHECK (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin']::public.school_role[]));
--> statement-breakpoint

CREATE POLICY invitations_select ON public.invitations FOR SELECT TO tushciemat_api
  USING (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin']::public.school_role[]));
CREATE POLICY invitations_insert ON public.invitations FOR INSERT TO tushciemat_api
  WITH CHECK (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin']::public.school_role[])
              AND invited_by_user_id = (SELECT app_private.current_user_id()));
CREATE POLICY invitations_update ON public.invitations FOR UPDATE TO tushciemat_api
  USING (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin']::public.school_role[]))
  WITH CHECK (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin']::public.school_role[]));
--> statement-breakpoint

CREATE POLICY academic_years_select ON public.academic_years FOR SELECT TO tushciemat_api
  USING (app_private.is_school_member(school_id));
CREATE POLICY academic_years_insert ON public.academic_years FOR INSERT TO tushciemat_api
  WITH CHECK (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[]));
CREATE POLICY academic_years_update ON public.academic_years FOR UPDATE TO tushciemat_api
  USING (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[]))
  WITH CHECK (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[]));
--> statement-breakpoint

CREATE POLICY terms_select ON public.terms FOR SELECT TO tushciemat_api
  USING (app_private.is_school_member(school_id));
CREATE POLICY terms_insert ON public.terms FOR INSERT TO tushciemat_api
  WITH CHECK (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[]));
CREATE POLICY terms_update ON public.terms FOR UPDATE TO tushciemat_api
  USING (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[]))
  WITH CHECK (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[]));
--> statement-breakpoint

CREATE POLICY school_classes_select ON public.school_classes FOR SELECT TO tushciemat_api
  USING (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin', 'bursar']::public.school_role[])
         OR app_private.teaches_class(id));
CREATE POLICY school_classes_insert ON public.school_classes FOR INSERT TO tushciemat_api
  WITH CHECK (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[]));
CREATE POLICY school_classes_update ON public.school_classes FOR UPDATE TO tushciemat_api
  USING (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[]))
  WITH CHECK (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[]));
--> statement-breakpoint

CREATE POLICY class_teacher_assignments_select ON public.class_teacher_assignments FOR SELECT TO tushciemat_api
  USING (teacher_user_id = (SELECT app_private.current_user_id())
         OR app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[]));
CREATE POLICY class_teacher_assignments_insert ON public.class_teacher_assignments FOR INSERT TO tushciemat_api
  WITH CHECK (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[])
              AND created_by_user_id = (SELECT app_private.current_user_id()));
CREATE POLICY class_teacher_assignments_delete ON public.class_teacher_assignments FOR DELETE TO tushciemat_api
  USING (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[]));
--> statement-breakpoint

CREATE POLICY students_select ON public.students FOR SELECT TO tushciemat_api
  USING (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin', 'bursar']::public.school_role[])
         OR app_private.teaches_class(class_id)
         OR app_private.is_guardian_of(id)
         OR app_private.is_student_self(id));
CREATE POLICY students_insert ON public.students FOR INSERT TO tushciemat_api
  WITH CHECK (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[]));
CREATE POLICY students_update ON public.students FOR UPDATE TO tushciemat_api
  USING (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[]))
  WITH CHECK (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[]));
--> statement-breakpoint

CREATE POLICY guardians_select ON public.guardians FOR SELECT TO tushciemat_api
  USING (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin', 'bursar']::public.school_role[])
         OR auth_user_id = (SELECT app_private.current_user_id()));
CREATE POLICY guardians_insert ON public.guardians FOR INSERT TO tushciemat_api
  WITH CHECK (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[]));
CREATE POLICY guardians_update ON public.guardians FOR UPDATE TO tushciemat_api
  USING (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[]))
  WITH CHECK (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[]));
--> statement-breakpoint

CREATE POLICY student_guardians_select ON public.student_guardians FOR SELECT TO tushciemat_api
  USING (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin', 'bursar']::public.school_role[])
         OR app_private.is_guardian_account(guardian_id));
CREATE POLICY student_guardians_insert ON public.student_guardians FOR INSERT TO tushciemat_api
  WITH CHECK (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[]));
CREATE POLICY student_guardians_update ON public.student_guardians FOR UPDATE TO tushciemat_api
  USING (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[]))
  WITH CHECK (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[]));
CREATE POLICY student_guardians_delete ON public.student_guardians FOR DELETE TO tushciemat_api
  USING (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[]));
--> statement-breakpoint

CREATE POLICY attendance_select ON public.attendance_records FOR SELECT TO tushciemat_api
  USING (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[])
         OR app_private.teaches_class(class_id)
         OR app_private.is_guardian_of(student_id)
         OR app_private.is_student_self(student_id));
CREATE POLICY attendance_insert ON public.attendance_records FOR INSERT TO tushciemat_api
  WITH CHECK (recorded_by = (SELECT app_private.current_user_id())
              AND (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[])
                   OR app_private.teaches_class(class_id)));
CREATE POLICY attendance_update ON public.attendance_records FOR UPDATE TO tushciemat_api
  USING (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[])
         OR app_private.teaches_class(class_id))
  WITH CHECK (recorded_by = (SELECT app_private.current_user_id())
              AND (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[])
                   OR app_private.teaches_class(class_id)));
--> statement-breakpoint

CREATE POLICY audit_logs_select ON public.audit_logs FOR SELECT TO tushciemat_api
  USING (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal']::public.school_role[]));
CREATE POLICY audit_logs_insert ON public.audit_logs FOR INSERT TO tushciemat_api
  WITH CHECK (actor_user_id = (SELECT app_private.current_user_id())
              AND app_private.is_school_member(school_id));
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Least-privilege grants. Column-level UPDATE keeps identity, tenancy and
-- account-link columns immutable through the API. No DELETE on school records.
-- ---------------------------------------------------------------------------

GRANT SELECT ON public.user_profiles TO tushciemat_api;
GRANT SELECT, INSERT ON public.schools TO tushciemat_api;
GRANT UPDATE (name, category, curriculum, county) ON public.schools TO tushciemat_api;
GRANT SELECT, INSERT ON public.school_memberships TO tushciemat_api;
GRANT UPDATE (role, status) ON public.school_memberships TO tushciemat_api;
GRANT SELECT, INSERT ON public.invitations TO tushciemat_api;
GRANT UPDATE (status) ON public.invitations TO tushciemat_api;
GRANT SELECT, INSERT ON public.academic_years TO tushciemat_api;
GRANT UPDATE (name, starts_on, ends_on, is_current) ON public.academic_years TO tushciemat_api;
GRANT SELECT, INSERT ON public.terms TO tushciemat_api;
GRANT UPDATE (name, starts_on, ends_on, is_current) ON public.terms TO tushciemat_api;
GRANT SELECT, INSERT ON public.school_classes TO tushciemat_api;
GRANT UPDATE (name, grade, stream) ON public.school_classes TO tushciemat_api;
GRANT SELECT, INSERT, DELETE ON public.class_teacher_assignments TO tushciemat_api;
GRANT SELECT, INSERT ON public.students TO tushciemat_api;
GRANT UPDATE (class_id, first_name, last_name, admission_number, status) ON public.students TO tushciemat_api;
GRANT SELECT, INSERT ON public.guardians TO tushciemat_api;
GRANT UPDATE (full_name, email, phone) ON public.guardians TO tushciemat_api;
GRANT SELECT, INSERT, DELETE ON public.student_guardians TO tushciemat_api;
GRANT UPDATE (relationship, is_primary) ON public.student_guardians TO tushciemat_api;
GRANT SELECT, INSERT ON public.attendance_records TO tushciemat_api;
GRANT UPDATE (class_id, status, note, recorded_by) ON public.attendance_records TO tushciemat_api;
GRANT SELECT, INSERT ON public.audit_logs TO tushciemat_api;
--> statement-breakpoint

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app_private FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private TO tushciemat_api;
--> statement-breakpoint

-- Supabase grants anon/authenticated broad default privileges on public.
-- Withdraw them for Tushciemat tables; direct Data API access is opt-in per feature.
DO $$
DECLARE
  api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format(
        'REVOKE ALL ON public.user_profiles, public.schools, public.school_memberships, public.invitations, '
        'public.academic_years, public.terms, public.school_classes, public.class_teacher_assignments, '
        'public.students, public.guardians, public.student_guardians, public.attendance_records, '
        'public.audit_logs FROM %I', api_role);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', api_role);
    END IF;
  END LOOP;
END
$$;
