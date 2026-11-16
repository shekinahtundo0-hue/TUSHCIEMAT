-- Gate4 stage1. Additive: applied migrations remain unchanged.
-- No implicit grants for new school_admin memberships; records.delete is reserved
-- for a later slice and does not add DELETE privileges on school records.
REVOKE ALL ON public.membership_capabilities FROM PUBLIC, tushciemat_api;
--> statement-breakpoint

-- Preserve existing access, including suspended memberships (status still gates use).
-- Run before installing owner-only write guards. This is the ONLY automatic grant.
INSERT INTO public.membership_capabilities (school_id, membership_id, capability)
SELECT m.school_id, m.id, c.capability
FROM public.school_memberships m
CROSS JOIN unnest(enum_range(NULL::public.school_capability)) AS c(capability)
WHERE m.role = 'school_admin' AND c.capability <> 'records.delete';
INSERT INTO public.audit_logs (school_id, actor_user_id, action, entity_type, entity_id, metadata)
SELECT m.school_id, 'migration:gate4-stage1', 'membership.capabilities_backfilled',
       'school_membership', m.id,
       jsonb_build_object('capabilities', jsonb_agg(c.capability ORDER BY c.capability))
FROM public.school_memberships m
JOIN public.membership_capabilities c ON c.membership_id = m.id
GROUP BY m.school_id, m.id;
--> statement-breakpoint

-- Internal arbitrary-identity lookup: never executable by runtime callers.
CREATE FUNCTION app_private.user_has_school_capability(p_school uuid, p_user text, p_capability text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_capability = ANY(enum_range(NULL::public.school_capability)::text[])
    AND EXISTS (
      SELECT 1 FROM public.school_memberships m
      JOIN public.user_profiles p ON p.auth_user_id = m.auth_user_id AND p.status = 'active'
      WHERE m.school_id = p_school AND m.auth_user_id = p_user AND m.status = 'active'
        AND (m.role = 'owner'
          OR (m.role IN ('principal', 'academic_admin') AND p_capability IN (
            'students.manage', 'academics.manage', 'attendance.manage',
            'assessments.manage', 'results.publish', 'resources.manage'))
          OR (m.role = 'school_admin' AND EXISTS (
            SELECT 1 FROM public.membership_capabilities c
            WHERE c.membership_id = m.id AND c.school_id = m.school_id
              AND c.capability::text = p_capability)))
    )
$$;
CREATE FUNCTION app_private.has_school_capability(p_school uuid, p_capability text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(app_private.user_has_school_capability(
    p_school, app_private.current_user_id(), p_capability), false)
$$;
--> statement-breakpoint

-- A row WRITE, not just an advisory/row lock: at REPEATABLE READ/SERIALIZABLE a
-- concurrent transition must fail with 40001 rather than count a stale owner.
-- All membership/capability/invitation changes and trusted authority checks use
-- this same lock. Updating the existing school row also refreshes updated_at.
-- Internal only; callers cannot use it to touch arbitrary schools.
CREATE FUNCTION app_private.lock_school_access(p_school uuid)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.schools SET updated_at = updated_at WHERE id = p_school;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'school was not found' USING ERRCODE = '23503';
  END IF;
END;
$$;
CREATE OR REPLACE FUNCTION app_private.can_bootstrap_school(p_school_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT app_private.is_active_profile() AND EXISTS (
    SELECT 1 FROM public.schools s WHERE s.id = p_school_id
      AND s.created_by_user_id = app_private.current_user_id()
  ) AND NOT app_private.school_has_members(p_school_id)
$$;
--> statement-breakpoint

CREATE FUNCTION app_private.enforce_membership_access_integrity()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  school uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.school_id ELSE NEW.school_id END;
  target text := CASE WHEN TG_OP = 'DELETE' THEN OLD.auth_user_id ELSE NEW.auth_user_id END;
  profile_status public.profile_status;
BEGIN
  PERFORM app_private.lock_school_access(school);
  IF TG_OP = 'UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id
     OR NEW.school_id IS DISTINCT FROM OLD.school_id OR NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id) THEN
    RAISE EXCEPTION 'membership identity and school cannot change' USING ERRCODE = '42501';
  END IF;
  -- Interlock owner creation/reactivation with profile disable/deletion.
  SELECT p.status INTO profile_status FROM public.user_profiles p
    WHERE p.auth_user_id = target FOR SHARE;
  IF TG_OP <> 'DELETE' AND NEW.status = 'active' AND profile_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'membership requires an active account' USING ERRCODE = '42501';
  END IF;
  IF TG_OP <> 'INSERT' AND OLD.role = 'owner' AND OLD.status = 'active'
     AND profile_status = 'active'
     AND (TG_OP = 'DELETE' OR NEW.role <> 'owner' OR NEW.status <> 'active') THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.school_memberships m
      JOIN public.user_profiles p ON p.auth_user_id = m.auth_user_id AND p.status = 'active'
      WHERE m.school_id = school AND m.id <> OLD.id AND m.role = 'owner' AND m.status = 'active'
    ) THEN
      RAISE EXCEPTION 'cannot remove the last active owner' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.role = 'school_admin' AND NEW.role <> 'school_admin'
     AND EXISTS (SELECT 1 FROM public.membership_capabilities c WHERE c.membership_id = OLD.id) THEN
    RAISE EXCEPTION 'revoke explicit capabilities before changing this role' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER school_memberships_00_access_integrity BEFORE INSERT OR UPDATE OR DELETE
  ON public.school_memberships FOR EACH ROW EXECUTE FUNCTION app_private.enforce_membership_access_integrity();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_private.guard_membership_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  actor text := app_private.current_user_id();
  bootstrap boolean;
  owner boolean;
BEGIN
  IF NOT app_private.is_request_role() THEN RETURN NEW; END IF;
  IF actor IS NULL OR NOT app_private.is_active_profile() THEN
    RAISE EXCEPTION 'active account is required' USING ERRCODE = '42501';
  END IF;
  owner := app_private.has_school_role(NEW.school_id, ARRAY['owner']::public.school_role[]);
  IF TG_OP = 'INSERT' THEN
    bootstrap := NEW.auth_user_id = actor AND NEW.role = 'owner' AND NEW.status = 'active'
      AND app_private.can_bootstrap_school(NEW.school_id);
    IF NEW.auth_user_id = actor AND NOT bootstrap THEN
      RAISE EXCEPTION 'you cannot grant yourself a school role' USING ERRCODE = '42501';
    END IF;
    IF NEW.role IN ('owner', 'school_admin', 'principal', 'academic_admin', 'bursar')
       AND NOT owner AND NOT bootstrap THEN
      RAISE EXCEPTION 'only an owner can grant privileged roles' USING ERRCODE = '42501';
    END IF;
    IF NOT bootstrap AND NOT app_private.has_school_capability(NEW.school_id, 'people.manage') THEN
      RAISE EXCEPTION 'people.manage is required' USING ERRCODE = '42501';
    END IF;
    NEW.created_by_user_id := actor;
  ELSE
    IF OLD.auth_user_id = actor THEN
      RAISE EXCEPTION 'you cannot change your own role or access' USING ERRCODE = '42501';
    END IF;
    IF (OLD.role IN ('owner', 'school_admin', 'principal', 'academic_admin', 'bursar')
        OR NEW.role IN ('owner', 'school_admin', 'principal', 'academic_admin', 'bursar')) AND NOT owner THEN
      RAISE EXCEPTION 'only an owner can alter privileged memberships' USING ERRCODE = '42501';
    END IF;
    IF NOT app_private.has_school_capability(NEW.school_id, 'people.manage') THEN
      RAISE EXCEPTION 'people.manage is required' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

-- Applies to operator profile status changes as well as mark_user_deleted.
CREATE FUNCTION app_private.guard_profile_owner_access()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE school uuid;
BEGIN
  IF OLD.status = 'active' AND NEW.status <> 'active' THEN
    FOR school IN SELECT DISTINCT m.school_id FROM public.school_memberships m
      WHERE m.auth_user_id = OLD.auth_user_id AND m.role = 'owner' AND m.status = 'active'
      ORDER BY m.school_id
    LOOP
      PERFORM app_private.lock_school_access(school);
      IF NOT EXISTS (
        SELECT 1 FROM public.school_memberships m
        JOIN public.user_profiles p ON p.auth_user_id = m.auth_user_id AND p.status = 'active'
        WHERE m.school_id = school AND m.auth_user_id <> OLD.auth_user_id
          AND m.role = 'owner' AND m.status = 'active'
      ) THEN
        RAISE EXCEPTION 'cannot deactivate the last active owner' USING ERRCODE = '42501';
      END IF;
      INSERT INTO public.audit_logs (school_id, actor_user_id, action, entity_type, entity_id, metadata)
      VALUES (school, coalesce(app_private.current_user_id(), 'database:operator'),
              'owner.account_deactivated', 'user_profile', OLD.id,
              jsonb_build_object('fromStatus', OLD.status, 'toStatus', NEW.status));
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER user_profiles_owner_access_guard BEFORE UPDATE OF status ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_profile_owner_access();
CREATE OR REPLACE FUNCTION app_private.mark_user_deleted(p_user_id text)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE school uuid;
BEGIN
  IF p_user_id IS NULL OR p_user_id IS DISTINCT FROM app_private.current_user_id() THEN
    RAISE EXCEPTION 'only the verified identity can be marked deleted' USING ERRCODE = '42501';
  END IF;
  PERFORM p.id FROM public.user_profiles p WHERE p.auth_user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'account was not found' USING ERRCODE = 'P0002'; END IF;
  FOR school IN SELECT DISTINCT m.school_id FROM public.school_memberships m
    WHERE m.auth_user_id = p_user_id ORDER BY m.school_id
  LOOP
    PERFORM app_private.lock_school_access(school);
  END LOOP;
  -- The profile trigger refuses loss of any school's last effective owner.
  UPDATE public.user_profiles
    SET status = 'deleted', deleted_at = now(), email = NULL, full_name = NULL, image_url = NULL
    WHERE auth_user_id = p_user_id;
  UPDATE public.school_memberships SET status = 'suspended' WHERE auth_user_id = p_user_id;
END;
$$;
--> statement-breakpoint

CREATE FUNCTION app_private.guard_member_capabilities()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  school uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.school_id ELSE NEW.school_id END;
  membership uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.membership_id ELSE NEW.membership_id END;
  target public.school_memberships;
BEGIN
  PERFORM app_private.lock_school_access(school);
  IF NOT app_private.has_school_role(school, ARRAY['owner']::public.school_role[]) THEN
    RAISE EXCEPTION 'active owner access is required' USING ERRCODE = '42501';
  END IF;
  SELECT m.* INTO target FROM public.school_memberships m WHERE m.id = membership FOR UPDATE;
  IF target.id IS NULL OR target.school_id <> school OR target.role <> 'school_admin' THEN
    RAISE EXCEPTION 'capabilities require a school_admin membership in the same school' USING ERRCODE = '23514';
  END IF;
  IF target.auth_user_id = app_private.current_user_id() THEN
    RAISE EXCEPTION 'you cannot change your own membership capabilities' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'replace capabilities with delete and insert or set_member_capabilities' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  NEW.created_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER membership_capabilities_guard BEFORE INSERT OR UPDATE OR DELETE
  ON public.membership_capabilities FOR EACH ROW EXECUTE FUNCTION app_private.guard_member_capabilities();
--> statement-breakpoint

-- Mandatory, fail-closed audit: no exception swallowing and no tokens, contacts,
-- applicant details, or other secret values in metadata.
CREATE FUNCTION app_private.audit_access_transition()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  school uuid;
  entity uuid;
  details jsonb;
  action_name text;
BEGIN
  IF TG_TABLE_NAME = 'membership_capabilities' THEN
    school := CASE WHEN TG_OP = 'DELETE' THEN OLD.school_id ELSE NEW.school_id END;
    entity := CASE WHEN TG_OP = 'DELETE' THEN OLD.membership_id ELSE NEW.membership_id END;
    details := jsonb_build_object('capability', CASE WHEN TG_OP = 'DELETE' THEN OLD.capability ELSE NEW.capability END);
    action_name := CASE WHEN TG_OP = 'DELETE' THEN 'membership.capability_revoked' ELSE 'membership.capability_granted' END;
  ELSIF TG_TABLE_NAME = 'school_memberships' THEN
    IF TG_OP = 'UPDATE' AND NEW.role = OLD.role AND NEW.status = OLD.status THEN RETURN NEW; END IF;
    school := CASE WHEN TG_OP = 'DELETE' THEN OLD.school_id ELSE NEW.school_id END;
    entity := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
    details := jsonb_build_object('operation', TG_OP,
      'fromRole', CASE WHEN TG_OP <> 'INSERT' THEN OLD.role END,
      'toRole', CASE WHEN TG_OP <> 'DELETE' THEN NEW.role END,
      'fromStatus', CASE WHEN TG_OP <> 'INSERT' THEN OLD.status END,
      'toStatus', CASE WHEN TG_OP <> 'DELETE' THEN NEW.status END);
    action_name := 'membership.access_changed';
  ELSE
    school := NEW.school_id;
    entity := NEW.id;
    details := jsonb_build_object('operation', TG_OP, 'role', NEW.role, 'status', NEW.status);
    action_name := 'invitation.access_changed';
  END IF;
  INSERT INTO public.audit_logs (school_id, actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (school, coalesce(app_private.current_user_id(), 'database:operator'), action_name,
          TG_TABLE_NAME, entity, details);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER membership_capabilities_audit AFTER INSERT OR UPDATE OR DELETE ON public.membership_capabilities
  FOR EACH ROW EXECUTE FUNCTION app_private.audit_access_transition();
CREATE TRIGGER school_memberships_access_audit AFTER INSERT OR UPDATE OR DELETE ON public.school_memberships
  FOR EACH ROW EXECUTE FUNCTION app_private.audit_access_transition();
CREATE TRIGGER invitations_access_audit AFTER INSERT OR UPDATE ON public.invitations
  FOR EACH ROW EXECUTE FUNCTION app_private.audit_access_transition();
--> statement-breakpoint

CREATE FUNCTION app_private.set_member_capabilities(p_school uuid, p_membership uuid, p_capabilities text[])
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target public.school_memberships;
  previous text[];
BEGIN
  PERFORM app_private.lock_school_access(p_school);
  IF NOT app_private.has_school_role(p_school, ARRAY['owner']::public.school_role[]) THEN
    RAISE EXCEPTION 'active owner access is required' USING ERRCODE = '42501';
  END IF;
  SELECT m.* INTO target FROM public.school_memberships m WHERE m.id = p_membership FOR UPDATE;
  IF target.id IS NULL OR target.school_id <> p_school OR target.role <> 'school_admin' THEN
    RAISE EXCEPTION 'target must be a school_admin membership in this school' USING ERRCODE = '23514';
  END IF;
  IF target.auth_user_id = app_private.current_user_id() THEN
    RAISE EXCEPTION 'you cannot change your own membership capabilities' USING ERRCODE = '42501';
  END IF;
  IF p_capabilities IS NULL OR coalesce(array_ndims(p_capabilities), 1) <> 1
     OR cardinality(p_capabilities) > cardinality(enum_range(NULL::public.school_capability))
     OR EXISTS (SELECT 1 FROM unnest(p_capabilities) c WHERE c IS NULL
                OR NOT c = ANY(enum_range(NULL::public.school_capability)::text[]))
     OR cardinality(p_capabilities) <> (SELECT count(DISTINCT c) FROM unnest(p_capabilities) c) THEN
    RAISE EXCEPTION 'capabilities must be a non-null array of valid unique capability values' USING ERRCODE = '22023';
  END IF;
  SELECT coalesce(array_agg(c.capability::text ORDER BY c.capability::text), ARRAY[]::text[]) INTO previous
    FROM public.membership_capabilities c WHERE c.membership_id = p_membership;
  DELETE FROM public.membership_capabilities WHERE membership_id = p_membership;
  INSERT INTO public.membership_capabilities (school_id, membership_id, capability)
    SELECT p_school, p_membership, c::public.school_capability FROM unnest(p_capabilities) c;
  INSERT INTO public.audit_logs (school_id, actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (p_school, app_private.current_user_id(), 'membership.capabilities_replaced', 'school_membership', p_membership,
          jsonb_build_object('before', previous, 'after', p_capabilities));
END;
$$;
--> statement-breakpoint

CREATE FUNCTION app_private.serialize_invitation_access()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM app_private.lock_school_access(NEW.school_id);
  RETURN NEW;
END;
$$;
CREATE TRIGGER invitations_00_serialize BEFORE INSERT OR UPDATE ON public.invitations
  FOR EACH ROW EXECUTE FUNCTION app_private.serialize_invitation_access();
CREATE OR REPLACE FUNCTION app_private.guard_invitation_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT app_private.is_request_role() THEN RETURN NEW; END IF;
  IF NOT app_private.has_school_capability(NEW.school_id, 'people.manage') THEN
    RAISE EXCEPTION 'people.manage is required' USING ERRCODE = '42501';
  END IF;
  IF NEW.role IN ('owner', 'school_admin', 'principal', 'academic_admin', 'bursar')
     AND NOT app_private.has_school_role(NEW.school_id, ARRAY['owner']::public.school_role[]) THEN
    RAISE EXCEPTION 'only an owner can manage privileged invitations' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.invited_by_user_id IS DISTINCT FROM app_private.current_user_id()
       OR NEW.status <> 'pending' OR NEW.accepted_by_user_id IS NOT NULL
       OR NEW.accepted_at IS NOT NULL OR NEW.revoked_at IS NOT NULL THEN
      RAISE EXCEPTION 'new invitations must be pending and belong to the inviter' USING ERRCODE = '42501';
    END IF;
    IF NEW.role IN ('student', 'parent') AND NOT app_private.has_school_capability(NEW.school_id, 'students.manage') THEN
      RAISE EXCEPTION 'students.manage is required to link learner or guardian accounts' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF (to_jsonb(NEW) - 'status' - 'revoked_at') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'revoked_at')
       OR NOT (OLD.status = 'pending' AND NEW.status = 'revoked') THEN
      RAISE EXCEPTION 'only pending invitations can be revoked' USING ERRCODE = '42501';
    END IF;
    NEW.revoked_at := now();
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE POLICY membership_capabilities_select ON public.membership_capabilities FOR SELECT TO tushciemat_api
  USING (app_private.has_school_role(school_id, ARRAY['owner']::public.school_role[])
    OR ((SELECT app_private.is_active_profile()) AND EXISTS (
      SELECT 1 FROM public.school_memberships m WHERE m.id = membership_id AND m.school_id = membership_capabilities.school_id
        AND m.auth_user_id = (SELECT app_private.current_user_id()) AND m.role = 'school_admin' AND m.status = 'active')));
CREATE POLICY membership_capabilities_insert ON public.membership_capabilities FOR INSERT TO tushciemat_api
  WITH CHECK (app_private.has_school_role(school_id, ARRAY['owner']::public.school_role[]));
CREATE POLICY membership_capabilities_delete ON public.membership_capabilities FOR DELETE TO tushciemat_api
  USING (app_private.has_school_role(school_id, ARRAY['owner']::public.school_role[]));
GRANT SELECT, INSERT, DELETE ON public.membership_capabilities TO tushciemat_api;
--> statement-breakpoint

ALTER POLICY schools_update ON public.schools
  USING (app_private.has_school_capability(id, 'settings.manage'))
  WITH CHECK (app_private.has_school_capability(id, 'settings.manage'));
ALTER POLICY school_memberships_select ON public.school_memberships
  USING ((auth_user_id = (SELECT app_private.current_user_id()) AND (SELECT app_private.is_active_profile()))
    OR app_private.has_school_capability(school_id, 'people.manage')
    OR (role = 'teacher' AND app_private.has_school_capability(school_id, 'academics.manage')));
ALTER POLICY school_memberships_insert ON public.school_memberships
  WITH CHECK (app_private.has_school_capability(school_id, 'people.manage')
    OR (auth_user_id = (SELECT app_private.current_user_id()) AND role = 'owner' AND status = 'active'
      AND app_private.can_bootstrap_school(school_id)));
ALTER POLICY school_memberships_update ON public.school_memberships
  USING (app_private.has_school_capability(school_id, 'people.manage'))
  WITH CHECK (app_private.has_school_capability(school_id, 'people.manage'));
ALTER POLICY invitations_select ON public.invitations USING (app_private.has_school_capability(school_id, 'people.manage'));
ALTER POLICY invitations_insert ON public.invitations
  WITH CHECK (app_private.has_school_capability(school_id, 'people.manage')
    AND invited_by_user_id = (SELECT app_private.current_user_id()));
ALTER POLICY invitations_update ON public.invitations
  USING (app_private.has_school_capability(school_id, 'people.manage'))
  WITH CHECK (app_private.has_school_capability(school_id, 'people.manage'));
--> statement-breakpoint

ALTER POLICY academic_years_insert ON public.academic_years WITH CHECK (app_private.has_school_capability(school_id, 'academics.manage'));
ALTER POLICY academic_years_update ON public.academic_years
  USING (app_private.has_school_capability(school_id, 'academics.manage'))
  WITH CHECK (app_private.has_school_capability(school_id, 'academics.manage'));
ALTER POLICY terms_insert ON public.terms WITH CHECK (app_private.has_school_capability(school_id, 'academics.manage'));
ALTER POLICY terms_update ON public.terms
  USING (app_private.has_school_capability(school_id, 'academics.manage'))
  WITH CHECK (app_private.has_school_capability(school_id, 'academics.manage'));
ALTER POLICY school_classes_select ON public.school_classes
  USING (app_private.has_school_capability(school_id, 'academics.manage')
    OR app_private.has_school_capability(school_id, 'students.manage')
    OR app_private.has_school_capability(school_id, 'attendance.manage')
    OR app_private.has_school_role(school_id, ARRAY['bursar']::public.school_role[])
    OR app_private.teaches_class(id) OR app_private.can_view_learner_class(id));
ALTER POLICY school_classes_insert ON public.school_classes WITH CHECK (app_private.has_school_capability(school_id, 'academics.manage'));
ALTER POLICY school_classes_update ON public.school_classes
  USING (app_private.has_school_capability(school_id, 'academics.manage'))
  WITH CHECK (app_private.has_school_capability(school_id, 'academics.manage'));
ALTER POLICY class_teacher_assignments_select ON public.class_teacher_assignments
  USING (app_private.has_school_capability(school_id, 'academics.manage')
    OR (teacher_user_id = (SELECT app_private.current_user_id()) AND app_private.teaches_class(class_id)));
ALTER POLICY class_teacher_assignments_insert ON public.class_teacher_assignments
  WITH CHECK (app_private.has_school_capability(school_id, 'academics.manage')
    AND created_by_user_id = (SELECT app_private.current_user_id()));
ALTER POLICY class_teacher_assignments_delete ON public.class_teacher_assignments
  USING (app_private.has_school_capability(school_id, 'academics.manage'));
--> statement-breakpoint

ALTER POLICY students_select ON public.students
  USING (app_private.has_school_capability(school_id, 'students.manage')
    OR app_private.has_school_capability(school_id, 'attendance.manage')
    OR app_private.has_school_role(school_id, ARRAY['bursar']::public.school_role[])
    OR app_private.teaches_class(class_id) OR app_private.is_guardian_of(id) OR app_private.is_student_self(id));
ALTER POLICY students_insert ON public.students WITH CHECK (app_private.has_school_capability(school_id, 'students.manage'));
ALTER POLICY students_update ON public.students
  USING (app_private.has_school_capability(school_id, 'students.manage'))
  WITH CHECK (app_private.has_school_capability(school_id, 'students.manage'));
CREATE OR REPLACE FUNCTION app_private.is_guardian_account(p_guardian_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM public.guardians g WHERE g.id = p_guardian_id
    AND g.auth_user_id = app_private.current_user_id()
    AND app_private.has_school_role(g.school_id, ARRAY['parent']::public.school_role[]))
$$;
ALTER POLICY guardians_select ON public.guardians
  USING (app_private.has_school_capability(school_id, 'students.manage')
    OR app_private.has_school_role(school_id, ARRAY['bursar']::public.school_role[])
    OR app_private.is_guardian_account(id));
ALTER POLICY guardians_insert ON public.guardians WITH CHECK (app_private.has_school_capability(school_id, 'students.manage'));
ALTER POLICY guardians_update ON public.guardians
  USING (app_private.has_school_capability(school_id, 'students.manage'))
  WITH CHECK (app_private.has_school_capability(school_id, 'students.manage'));
ALTER POLICY student_guardians_select ON public.student_guardians
  USING (app_private.has_school_capability(school_id, 'students.manage')
    OR app_private.has_school_role(school_id, ARRAY['bursar']::public.school_role[])
    OR app_private.is_guardian_account(guardian_id));
ALTER POLICY student_guardians_insert ON public.student_guardians WITH CHECK (app_private.has_school_capability(school_id, 'students.manage'));
ALTER POLICY student_guardians_update ON public.student_guardians
  USING (app_private.has_school_capability(school_id, 'students.manage'))
  WITH CHECK (app_private.has_school_capability(school_id, 'students.manage'));
ALTER POLICY student_guardians_delete ON public.student_guardians USING (app_private.has_school_capability(school_id, 'students.manage'));
--> statement-breakpoint

ALTER POLICY attendance_select ON public.attendance_records
  USING (app_private.has_school_capability(school_id, 'attendance.manage')
    OR app_private.teaches_class(class_id) OR app_private.is_guardian_of(student_id) OR app_private.is_student_self(student_id));
ALTER POLICY attendance_insert ON public.attendance_records
  WITH CHECK (recorded_by = (SELECT app_private.current_user_id())
    AND (app_private.has_school_capability(school_id, 'attendance.manage') OR app_private.teaches_class(class_id)));
ALTER POLICY attendance_update ON public.attendance_records
  USING (app_private.has_school_capability(school_id, 'attendance.manage') OR app_private.teaches_class(class_id))
  WITH CHECK (recorded_by = (SELECT app_private.current_user_id())
    AND (app_private.has_school_capability(school_id, 'attendance.manage') OR app_private.teaches_class(class_id)));
ALTER POLICY school_join_requests_select ON public.school_join_requests
  USING ((auth_user_id = (SELECT app_private.current_user_id()) AND (SELECT app_private.is_active_profile()))
    OR app_private.has_school_capability(school_id, 'requests.review'));
ALTER POLICY notifications_select ON public.notifications
  USING (auth_user_id = (SELECT app_private.current_user_id()) AND (SELECT app_private.is_active_profile())
    AND (type <> 'request.submitted' OR app_private.has_school_capability(school_id, 'requests.review')));
ALTER POLICY notifications_update ON public.notifications
  USING (auth_user_id = (SELECT app_private.current_user_id()) AND (SELECT app_private.is_active_profile())
    AND (type <> 'request.submitted' OR app_private.has_school_capability(school_id, 'requests.review')))
  WITH CHECK (auth_user_id = (SELECT app_private.current_user_id()) AND (SELECT app_private.is_active_profile())
    AND (type <> 'request.submitted' OR app_private.has_school_capability(school_id, 'requests.review')));
ALTER POLICY audit_logs_select ON public.audit_logs
  USING (app_private.has_school_role(school_id, ARRAY['owner']::public.school_role[]));
--> statement-breakpoint

-- Narrow the old callable contact helpers as well as table policies.
CREATE OR REPLACE FUNCTION app_private.is_visible_profile(p_user_id text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM public.school_memberships m WHERE m.auth_user_id = p_user_id
    AND app_private.has_school_capability(m.school_id, 'people.manage'))
$$;
CREATE OR REPLACE FUNCTION app_private.school_people(p_school_id uuid)
RETURNS TABLE (auth_user_id text, full_name text, email text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE actor text := app_private.current_user_id();
BEGIN
  IF NOT app_private.is_school_member(p_school_id) THEN
    RAISE EXCEPTION 'active school membership is required' USING ERRCODE = '42501';
  END IF;
  IF app_private.has_school_capability(p_school_id, 'people.manage') THEN
    RETURN QUERY SELECT p.auth_user_id, p.full_name, p.email FROM public.user_profiles p
      WHERE EXISTS (SELECT 1 FROM public.school_memberships m
        WHERE m.school_id = p_school_id AND m.auth_user_id = p.auth_user_id) ORDER BY p.auth_user_id;
  ELSIF app_private.has_school_capability(p_school_id, 'academics.manage') THEN
    RETURN QUERY SELECT p.auth_user_id, p.full_name, p.email FROM public.user_profiles p
      WHERE p.status = 'active' AND EXISTS (SELECT 1 FROM public.school_memberships m
        WHERE m.school_id = p_school_id AND m.auth_user_id = p.auth_user_id AND m.role = 'teacher' AND m.status = 'active')
      ORDER BY p.auth_user_id;
  ELSIF app_private.has_school_role(p_school_id, ARRAY['teacher']::public.school_role[]) THEN
    RETURN QUERY
      SELECT p.auth_user_id, p.full_name, CASE WHEN p.auth_user_id = actor THEN p.email ELSE NULL::text END
      FROM public.user_profiles p WHERE p.status = 'active'
        AND (p.auth_user_id = actor OR EXISTS (
          SELECT 1 FROM public.class_teacher_assignments target
          JOIN public.class_teacher_assignments own ON own.class_id = target.class_id AND own.school_id = target.school_id
          JOIN public.school_memberships m ON m.school_id = target.school_id AND m.auth_user_id = target.teacher_user_id
            AND m.role = 'teacher' AND m.status = 'active'
          WHERE own.school_id = p_school_id AND own.teacher_user_id = actor AND target.teacher_user_id = p.auth_user_id
        )) ORDER BY p.auth_user_id;
  ELSE
    RAISE EXCEPTION 'people.manage, academics.manage or scoped teacher access is required' USING ERRCODE = '42501';
  END IF;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_private.submit_join_request(p_school_id uuid, p_role public.school_role, p_details jsonb)
RETURNS public.school_join_requests
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor text := app_private.current_user_id();
  profile public.user_profiles;
  school public.schools;
  membership public.school_memberships;
  applicant_name text;
  result public.school_join_requests;
BEGIN
  SELECT p.* INTO profile FROM public.user_profiles p WHERE p.auth_user_id = actor FOR UPDATE;
  IF profile.id IS NULL OR profile.status <> 'active' OR nullif(btrim(profile.email), '') IS NULL THEN
    RAISE EXCEPTION 'an active account with verified email is required' USING ERRCODE = '42501';
  END IF;
  IF p_role IS NULL OR p_role NOT IN ('student', 'teacher', 'school_admin', 'parent') THEN
    RAISE EXCEPTION 'invalid requested role' USING ERRCODE = '22023';
  END IF;
  IF p_details IS NULL OR jsonb_typeof(p_details) <> 'object' OR octet_length(p_details::text) > 8000
     OR jsonb_typeof(p_details -> 'fullName') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'details must be an object of at most 8000 bytes with a fullName' USING ERRCODE = '22023';
  END IF;
  applicant_name := btrim(regexp_replace(p_details ->> 'fullName', '[[:space:]]+', ' ', 'g'));
  IF char_length(applicant_name) NOT BETWEEN 2 AND 160 THEN
    RAISE EXCEPTION 'fullName must contain 2 to 160 characters' USING ERRCODE = '22023';
  END IF;
  SELECT s.* INTO school FROM public.schools s WHERE s.id = p_school_id AND s.discoverable FOR SHARE;
  IF school.id IS NULL THEN RAISE EXCEPTION 'school is not available' USING ERRCODE = 'P0002'; END IF;
  SELECT m.* INTO membership FROM public.school_memberships m
    WHERE m.school_id = p_school_id AND m.auth_user_id = actor AND m.role = p_role FOR UPDATE;
  IF membership.id IS NOT NULL THEN
    IF membership.status = 'suspended' THEN
      RAISE EXCEPTION 'contact a school administrator about suspended access' USING ERRCODE = '42501';
    END IF;
    RAISE EXCEPTION 'you already hold this school role' USING ERRCODE = '23505';
  END IF;
  INSERT INTO public.school_join_requests
    (school_id, auth_user_id, requested_role, school_name, applicant_name, applicant_email, applicant_details)
  VALUES (school.id, actor, p_role, btrim(regexp_replace(school.name, '[[:space:]]+', ' ', 'g')),
          applicant_name, lower(profile.email), p_details) RETURNING * INTO result;
  INSERT INTO public.notifications (school_id, auth_user_id, type, title, body, entity_id)
    SELECT DISTINCT school.id, m.auth_user_id, 'request.submitted', 'New school join request',
           applicant_name || ' requested the ' || p_role::text || ' role.', result.id
    FROM public.school_memberships m WHERE m.school_id = school.id
      AND app_private.user_has_school_capability(school.id, m.auth_user_id, 'requests.review');
  INSERT INTO public.audit_logs (school_id, actor_user_id, action, entity_type, entity_id, metadata)
    VALUES (school.id, actor, 'request.submitted', 'school_join_request', result.id, jsonb_build_object('role', p_role));
  RETURN result;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_private.review_join_request(
  p_school_id uuid, p_request_id uuid, p_decision text, p_reason text DEFAULT NULL,
  p_student_id uuid DEFAULT NULL, p_guardian_id uuid DEFAULT NULL
)
RETURNS public.school_join_requests
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor text := app_private.current_user_id();
  request public.school_join_requests;
  profile public.user_profiles;
  guardian public.guardians;
  membership_id uuid;
  reason text;
BEGIN
  PERFORM app_private.lock_school_access(p_school_id);
  IF NOT app_private.has_school_capability(p_school_id, 'requests.review') THEN
    RAISE EXCEPTION 'requests.review is required' USING ERRCODE = '42501';
  END IF;
  IF p_decision IS NULL OR p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'decision must be approved or rejected' USING ERRCODE = '22023';
  END IF;
  SELECT r.* INTO request FROM public.school_join_requests r
    WHERE r.id = p_request_id AND r.school_id = p_school_id AND r.status = 'pending' FOR UPDATE;
  IF request.id IS NULL THEN RAISE EXCEPTION 'pending request was not found' USING ERRCODE = 'P0002'; END IF;
  IF request.auth_user_id = actor THEN
    RAISE EXCEPTION 'you cannot review your own request' USING ERRCODE = '42501';
  END IF;
  IF p_decision = 'rejected' THEN
    reason := btrim(regexp_replace(p_reason, '^[[:space:]]+|[[:space:]]+$', '', 'g'));
    IF reason IS NULL OR char_length(reason) NOT BETWEEN 3 AND 500 THEN
      RAISE EXCEPTION 'rejection reason must contain 3 to 500 characters' USING ERRCODE = '22023';
    END IF;
    UPDATE public.school_join_requests r
      SET status = 'rejected', reviewed_by_user_id = actor, reviewed_at = now(), rejection_reason = reason,
          student_id = NULL, guardian_id = NULL WHERE r.id = request.id RETURNING r.* INTO request;
  ELSE
    SELECT p.* INTO profile FROM public.user_profiles p WHERE p.auth_user_id = request.auth_user_id FOR UPDATE;
    IF profile.id IS NULL OR profile.status <> 'active' OR profile.email IS NULL OR lower(profile.email) <> request.applicant_email THEN
      RAISE EXCEPTION 'applicant must still be active with the same verified email' USING ERRCODE = '42501';
    END IF;
    IF request.requested_role NOT IN ('student', 'teacher', 'school_admin', 'parent') THEN
      RAISE EXCEPTION 'invalid requested role' USING ERRCODE = '42501';
    END IF;
    PERFORM m.id FROM public.school_memberships m
      WHERE m.school_id = p_school_id AND m.auth_user_id = request.auth_user_id
        AND m.role = request.requested_role AND m.status = 'suspended' FOR UPDATE;
    IF FOUND THEN
      RAISE EXCEPTION 'suspended membership requires administrator resolution' USING ERRCODE = '42501';
    END IF;
    -- Review can create a NEW zero-capability school_admin only. Never revive,
    -- reuse, or modify an existing privileged membership through this path.
    IF request.requested_role = 'school_admin' AND EXISTS (
      SELECT 1 FROM public.school_memberships m WHERE m.school_id = p_school_id
        AND m.auth_user_id = request.auth_user_id AND m.role = 'school_admin'
    ) THEN
      RAISE EXCEPTION 'school_admin membership already exists; owner resolution is required' USING ERRCODE = '42501';
    END IF;
    IF request.requested_role IN ('student', 'parent')
       AND NOT app_private.has_school_capability(p_school_id, 'students.manage') THEN
      RAISE EXCEPTION 'students.manage is required to link learner or guardian accounts' USING ERRCODE = '42501';
    END IF;
    IF request.requested_role = 'student' THEN
      IF p_student_id IS NULL THEN RAISE EXCEPTION 'an explicit student record is required' USING ERRCODE = '22023'; END IF;
      UPDATE public.students s SET auth_user_id = request.auth_user_id
        WHERE s.id = p_student_id AND s.school_id = p_school_id AND s.status = 'active'
          AND (s.auth_user_id IS NULL OR s.auth_user_id = request.auth_user_id);
      IF NOT FOUND THEN
        RAISE EXCEPTION 'student record is unavailable or linked to another account' USING ERRCODE = '23514';
      END IF;
    ELSIF request.requested_role = 'parent' THEN
      IF p_guardian_id IS NULL THEN RAISE EXCEPTION 'an explicit guardian record is required' USING ERRCODE = '22023'; END IF;
      SELECT g.* INTO guardian FROM public.guardians g WHERE g.id = p_guardian_id AND g.school_id = p_school_id FOR UPDATE;
      IF guardian.id IS NULL OR (guardian.auth_user_id IS NOT NULL AND guardian.auth_user_id <> request.auth_user_id)
         OR (guardian.email IS NOT NULL AND lower(btrim(guardian.email)) <> request.applicant_email) THEN
        RAISE EXCEPTION 'guardian record is unavailable or does not match the verified account' USING ERRCODE = '23514';
      END IF;
      PERFORM sg.id FROM public.student_guardians sg
        JOIN public.students s ON s.id = sg.student_id AND s.school_id = sg.school_id
        WHERE sg.guardian_id = guardian.id AND sg.school_id = p_school_id
        ORDER BY sg.id LIMIT 1 FOR SHARE OF sg, s;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'guardian must already be linked to a child in this school' USING ERRCODE = '23514';
      END IF;
      UPDATE public.guardians g SET auth_user_id = request.auth_user_id
        WHERE g.id = guardian.id AND g.school_id = p_school_id
          AND (g.auth_user_id IS NULL OR g.auth_user_id = request.auth_user_id);
      IF NOT FOUND THEN
        RAISE EXCEPTION 'guardian record is already linked to another account' USING ERRCODE = '23505';
      END IF;
    END IF;
    IF request.requested_role = 'school_admin' THEN
      INSERT INTO public.school_memberships (school_id, auth_user_id, role, status, created_by_user_id)
        VALUES (p_school_id, request.auth_user_id, 'school_admin', 'active', actor) RETURNING id INTO membership_id;
    ELSE
      INSERT INTO public.school_memberships (school_id, auth_user_id, role, status, created_by_user_id)
        VALUES (p_school_id, request.auth_user_id, request.requested_role, 'active', actor)
        ON CONFLICT (school_id, auth_user_id, role) DO UPDATE
          SET status = 'active', created_by_user_id = actor WHERE public.school_memberships.status = 'active'
        RETURNING id INTO membership_id;
      IF membership_id IS NULL THEN
        RAISE EXCEPTION 'suspended membership requires administrator resolution' USING ERRCODE = '42501';
      END IF;
    END IF;
    UPDATE public.school_join_requests r
      SET status = 'approved', reviewed_by_user_id = actor, reviewed_at = now(), rejection_reason = NULL,
          student_id = CASE WHEN request.requested_role = 'student' THEN p_student_id ELSE NULL END,
          guardian_id = CASE WHEN request.requested_role = 'parent' THEN p_guardian_id ELSE NULL END
      WHERE r.id = request.id RETURNING r.* INTO request;
  END IF;
  INSERT INTO public.notifications (school_id, auth_user_id, type, title, body, entity_id)
    VALUES (p_school_id, request.auth_user_id, 'request.' || p_decision,
      CASE WHEN p_decision = 'approved' THEN 'School join request approved' ELSE 'School join request rejected' END,
      CASE WHEN p_decision = 'approved' THEN 'Your ' || request.requested_role::text || ' request to ' || request.school_name || ' was approved.'
        ELSE reason END, request.id);
  INSERT INTO public.audit_logs (school_id, actor_user_id, action, entity_type, entity_id, metadata)
    VALUES (p_school_id, actor, 'request.' || p_decision, 'school_join_request', request.id,
      jsonb_build_object('role', request.requested_role, 'membershipId', membership_id,
        'studentId', request.student_id, 'guardianId', request.guardian_id));
  RETURN request;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_private.publish_announcement(p_school_id uuid, p_title text, p_body text)
RETURNS public.announcements
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor text := app_private.current_user_id();
  title_text text := btrim(regexp_replace(p_title, '^[[:space:]]+|[[:space:]]+$', '', 'g'));
  body_text text := btrim(regexp_replace(p_body, '^[[:space:]]+|[[:space:]]+$', '', 'g'));
  result public.announcements;
BEGIN
  PERFORM app_private.lock_school_access(p_school_id);
  IF NOT app_private.has_school_capability(p_school_id, 'announcements.manage') THEN
    RAISE EXCEPTION 'announcements.manage is required' USING ERRCODE = '42501';
  END IF;
  IF title_text IS NULL OR char_length(title_text) NOT BETWEEN 2 AND 160
     OR body_text IS NULL OR char_length(body_text) NOT BETWEEN 1 AND 5000 THEN
    RAISE EXCEPTION 'title must contain 2 to 160 characters and body 1 to 5000' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.announcements (school_id, author_user_id, title, body)
    VALUES (p_school_id, actor, title_text, body_text) RETURNING * INTO result;
  INSERT INTO public.notifications (school_id, auth_user_id, type, title, body, entity_id)
    SELECT DISTINCT p_school_id, m.auth_user_id, 'announcement.published', result.title, result.body, result.id
    FROM public.school_memberships m
    JOIN public.user_profiles p ON p.auth_user_id = m.auth_user_id AND p.status = 'active'
    WHERE m.school_id = p_school_id AND m.status = 'active';
  INSERT INTO public.audit_logs (school_id, actor_user_id, action, entity_type, entity_id, metadata)
    VALUES (p_school_id, actor, 'announcement.published', 'announcement', result.id, '{}'::jsonb);
  RETURN result;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_private.accept_invitation(p_token_hash text)
RETURNS TABLE (membership_id uuid, school_id uuid, role public.school_role)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  actor text := app_private.current_user_id();
  profile public.user_profiles;
  invite public.invitations;
  new_membership_id uuid;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'sign in is required' USING ERRCODE = '42501'; END IF;
  IF p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'invitation is not valid' USING ERRCODE = 'P0002';
  END IF;
  -- Discover the school without taking an invitation/profile lock first; then
  -- serialize with revocation, inviter role changes, and capability replacement.
  SELECT i.* INTO invite FROM public.invitations i WHERE i.token_hash = p_token_hash;
  IF invite.id IS NULL THEN RAISE EXCEPTION 'invitation is not valid' USING ERRCODE = 'P0002'; END IF;
  PERFORM app_private.lock_school_access(invite.school_id);
  SELECT p.* INTO profile FROM public.user_profiles p WHERE p.auth_user_id = actor FOR UPDATE;
  IF profile.id IS NULL OR profile.status <> 'active' THEN
    RAISE EXCEPTION 'account is not active' USING ERRCODE = '42501';
  END IF;
  SELECT i.* INTO invite FROM public.invitations i WHERE i.token_hash = p_token_hash FOR UPDATE;
  IF invite.id IS NULL OR invite.status <> 'pending' OR invite.expires_at <= now() THEN
    RAISE EXCEPTION 'invitation is not valid' USING ERRCODE = 'P0002';
  END IF;
  IF invite.invited_by_user_id = actor THEN
    RAISE EXCEPTION 'you cannot accept your own invitation' USING ERRCODE = '42501';
  END IF;
  IF profile.email IS NULL OR profile.email <> invite.email THEN
    RAISE EXCEPTION 'invitation was sent to a different email address' USING ERRCODE = '42501';
  END IF;
  -- The current inviter must still hold people.manage, and only a current owner
  -- can grant any privileged role. Account links additionally need students.manage.
  PERFORM p.id FROM public.user_profiles p WHERE p.auth_user_id = invite.invited_by_user_id AND p.status = 'active' FOR SHARE;
  IF NOT FOUND OR NOT coalesce(app_private.user_has_school_capability(invite.school_id, invite.invited_by_user_id, 'people.manage'), false)
     OR (invite.role IN ('owner', 'school_admin', 'principal', 'academic_admin', 'bursar') AND NOT EXISTS (
       SELECT 1 FROM public.school_memberships m WHERE m.school_id = invite.school_id
         AND m.auth_user_id = invite.invited_by_user_id AND m.role = 'owner' AND m.status = 'active'))
     OR (invite.role IN ('student', 'parent') AND NOT coalesce(app_private.user_has_school_capability(
       invite.school_id, invite.invited_by_user_id, 'students.manage'), false)) THEN
    RAISE EXCEPTION 'inviter no longer has authority to grant this role' USING ERRCODE = '42501';
  END IF;
  PERFORM m.id FROM public.school_memberships m WHERE m.school_id = invite.school_id AND m.auth_user_id = actor
    AND m.role = invite.role AND m.status = 'suspended' FOR UPDATE;
  IF FOUND THEN
    RAISE EXCEPTION 'suspended membership requires administrator resolution' USING ERRCODE = '42501';
  END IF;
  IF invite.role = 'student' THEN
    UPDATE public.students s SET auth_user_id = actor
      WHERE s.id = invite.student_id AND s.school_id = invite.school_id AND s.status = 'active'
        AND (s.auth_user_id IS NULL OR s.auth_user_id = actor);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'student record is unavailable or linked to another account' USING ERRCODE = '23505';
    END IF;
  ELSIF invite.role = 'parent' THEN
    UPDATE public.guardians g SET auth_user_id = actor
      WHERE g.id = invite.guardian_id AND g.school_id = invite.school_id
        AND (g.auth_user_id IS NULL OR g.auth_user_id = actor)
        AND (g.email IS NULL OR lower(btrim(g.email)) = profile.email);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'guardian record is unavailable or does not match the verified account' USING ERRCODE = '23505';
    END IF;
  END IF;
  INSERT INTO public.school_memberships (school_id, auth_user_id, role, status, created_by_user_id)
    VALUES (invite.school_id, actor, invite.role, 'active', invite.invited_by_user_id)
    ON CONFLICT (school_id, auth_user_id, role) DO UPDATE SET status = 'active'
      WHERE public.school_memberships.status = 'active' RETURNING id INTO new_membership_id;
  IF new_membership_id IS NULL THEN
    RAISE EXCEPTION 'suspended membership requires administrator resolution' USING ERRCODE = '42501';
  END IF;
  UPDATE public.invitations SET status = 'accepted', accepted_by_user_id = actor, accepted_at = now() WHERE id = invite.id;
  INSERT INTO public.audit_logs (school_id, actor_user_id, action, entity_type, entity_id, metadata)
    VALUES (invite.school_id, actor, 'invitation.accepted', 'invitation', invite.id,
      jsonb_build_object('role', invite.role, 'membershipId', new_membership_id));
  INSERT INTO public.notifications (school_id, auth_user_id, type, title, body, entity_id)
    SELECT DISTINCT invite.school_id, recipients.auth_user_id, 'invitation.accepted',
      'School invitation accepted', 'The ' || invite.role::text || ' invitation was accepted.', invite.id
    FROM (
      SELECT actor AS auth_user_id UNION
      SELECT m.auth_user_id FROM public.school_memberships m WHERE m.school_id = invite.school_id
        AND app_private.user_has_school_capability(invite.school_id, m.auth_user_id, 'people.manage')
    ) recipients;
  RETURN QUERY SELECT new_membership_id, invite.school_id, invite.role;
END;
$$;
CREATE OR REPLACE FUNCTION app_private.accept_school_invitation(p_token_hash text, p_school_id uuid, p_role public.school_role)
RETURNS TABLE (membership_id uuid, school_id uuid, role public.school_role)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT app_private.is_active_profile() THEN
    RAISE EXCEPTION 'account is not active' USING ERRCODE = '42501';
  END IF;
  PERFORM app_private.lock_school_access(p_school_id);
  PERFORM i.id FROM public.invitations i WHERE i.token_hash = p_token_hash
    AND i.school_id = p_school_id AND i.role = p_role AND i.status = 'pending' AND i.expires_at > now();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invitation is not valid for the selected school and role' USING ERRCODE = 'P0002';
  END IF;
  RETURN QUERY SELECT a.membership_id, a.school_id, a.role FROM app_private.accept_invitation(p_token_hash) a;
END;
$$;
--> statement-breakpoint

-- Trigger-only/internal functions are NOT RPCs. Never grant all functions.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app_private FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.user_has_school_capability(uuid, text, text),
  app_private.lock_school_access(uuid), app_private.enforce_membership_access_integrity(),
  app_private.guard_profile_owner_access(), app_private.guard_member_capabilities(),
  app_private.audit_access_transition(), app_private.serialize_invitation_access(),
  app_private.is_visible_profile(text) FROM tushciemat_api;
GRANT EXECUTE ON FUNCTION app_private.has_school_capability(uuid, text),
  app_private.set_member_capabilities(uuid, uuid, text[]) TO tushciemat_api;
-- CREATE OR REPLACE retains the existing runtime grants on the narrowed routines.
DO $$
DECLARE api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON public.membership_capabilities FROM %I', api_role);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app_private FROM %I', api_role);
    END IF;
  END LOOP;
END;
$$;
