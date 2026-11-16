ALTER TABLE public.school_join_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.school_join_requests, public.notifications, public.announcements FROM PUBLIC, tushciemat_api;
--> statement-breakpoint

CREATE FUNCTION app_private.is_active_profile()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles p
    WHERE p.auth_user_id = app_private.current_user_id() AND p.status = 'active'
  )
$$;
REVOKE ALL ON FUNCTION app_private.is_active_profile() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.is_active_profile() TO tushciemat_api;
--> statement-breakpoint

CREATE FUNCTION app_private.guard_school_metadata()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF app_private.is_request_role() THEN
    IF (TG_OP = 'INSERT' AND NEW.verification_status <> 'unverified')
       OR (TG_OP = 'UPDATE' AND NEW.verification_status IS DISTINCT FROM OLD.verification_status) THEN
      RAISE EXCEPTION 'school verification is operator controlled' USING ERRCODE = '42501';
    END IF;
  END IF;
  NEW.name := btrim(regexp_replace(NEW.name, '[[:space:]]+', ' ', 'g'));
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION app_private.guard_school_metadata() FROM PUBLIC, tushciemat_api;
CREATE TRIGGER schools_metadata_guard BEFORE INSERT OR UPDATE ON public.schools
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_school_metadata();
REVOKE UPDATE ON public.schools FROM tushciemat_api;
REVOKE UPDATE (verification_status) ON public.schools FROM tushciemat_api;
GRANT UPDATE (name, category, curriculum, country, county, town, logo_url, description,
              contact_email, contact_phone, website, discoverable) ON public.schools TO tushciemat_api;
ALTER POLICY schools_select ON public.schools
  USING (app_private.is_school_member(id)
         OR (created_by_user_id = (SELECT app_private.current_user_id())
             AND (SELECT app_private.is_active_profile())
             AND NOT app_private.school_has_members(id)));
ALTER POLICY schools_insert ON public.schools
  WITH CHECK (created_by_user_id = (SELECT app_private.current_user_id())
              AND (SELECT app_private.is_active_profile()));
ALTER POLICY schools_update ON public.schools
  USING (app_private.has_school_role(id, ARRAY['owner', 'school_admin']::public.school_role[]))
  WITH CHECK (app_private.has_school_role(id, ARRAY['owner', 'school_admin']::public.school_role[]));
--> statement-breakpoint

CREATE FUNCTION app_private.school_directory(
  p_search text DEFAULT NULL,
  p_school_id uuid DEFAULT NULL,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid, name text, category public.school_category, country text, county text,
  town text, logo_url text, description text, verification_status text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  search_text text;
  search_pattern text;
BEGIN
  IF NOT app_private.is_active_profile() THEN
    RAISE EXCEPTION 'account is not active' USING ERRCODE = '42501';
  END IF;
  IF p_school_id IS NOT NULL THEN
    RETURN QUERY
      SELECT s.id, btrim(regexp_replace(s.name, '[[:space:]]+', ' ', 'g')), s.category,
             s.country, s.county, s.town, s.logo_url, s.description, s.verification_status
      FROM public.schools s WHERE s.id = p_school_id AND s.discoverable
      LIMIT 1;
    RETURN;
  END IF;
  search_text := lower(btrim(regexp_replace(coalesce(p_search, ''), '[[:space:]]+', ' ', 'g')));
  IF char_length(search_text) = 1 OR char_length(search_text) > 160 THEN
    RAISE EXCEPTION 'search must be empty or contain 2 to 160 characters' USING ERRCODE = '22023';
  END IF;
  search_pattern := '%' || replace(replace(replace(search_text, chr(92), chr(92) || chr(92)),
                              '%', chr(92) || '%'), '_', chr(92) || '_') || '%';
  RETURN QUERY
    SELECT s.id, btrim(regexp_replace(s.name, '[[:space:]]+', ' ', 'g')), s.category,
           s.country, s.county, s.town, s.logo_url, s.description, s.verification_status
    FROM public.schools s
    WHERE s.discoverable
      AND lower(btrim(regexp_replace(s.name, '[[:space:]]+', ' ', 'g'))) LIKE search_pattern ESCAPE E'\\'
    ORDER BY lower(btrim(regexp_replace(s.name, '[[:space:]]+', ' ', 'g'))), s.id
    LIMIT 20 OFFSET greatest(0, least(2000, coalesce(p_offset, 0)));
END;
$$;
REVOKE ALL ON FUNCTION app_private.school_directory(text, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.school_directory(text, uuid, integer) TO tushciemat_api;
--> statement-breakpoint

CREATE FUNCTION app_private.school_people(p_school_id uuid)
RETURNS TABLE (auth_user_id text, full_name text, email text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor text := app_private.current_user_id();
BEGIN
  IF NOT app_private.is_school_member(p_school_id) THEN
    RAISE EXCEPTION 'active school membership is required' USING ERRCODE = '42501';
  END IF;
  IF app_private.has_school_role(p_school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[]) THEN
    RETURN QUERY
      SELECT p.auth_user_id, p.full_name, p.email
      FROM public.user_profiles p
      WHERE EXISTS (SELECT 1 FROM public.school_memberships m
                    WHERE m.school_id = p_school_id AND m.auth_user_id = p.auth_user_id)
      ORDER BY p.auth_user_id;
  ELSIF app_private.has_school_role(p_school_id, ARRAY['teacher']::public.school_role[]) THEN
    RETURN QUERY
      SELECT p.auth_user_id, p.full_name, CASE WHEN p.auth_user_id = actor THEN p.email ELSE NULL::text END
      FROM public.user_profiles p
      WHERE p.status = 'active'
        AND (p.auth_user_id = actor OR EXISTS (
          SELECT 1 FROM public.class_teacher_assignments target
          JOIN public.class_teacher_assignments own
            ON own.class_id = target.class_id AND own.school_id = target.school_id
          JOIN public.school_memberships m
            ON m.school_id = target.school_id AND m.auth_user_id = target.teacher_user_id
           AND m.role = 'teacher' AND m.status = 'active'
          WHERE own.school_id = p_school_id AND own.teacher_user_id = actor
            AND target.teacher_user_id = p.auth_user_id
        ))
      ORDER BY p.auth_user_id;
  ELSE
    RAISE EXCEPTION 'staff or teacher access is required' USING ERRCODE = '42501';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION app_private.school_people(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.school_people(uuid) TO tushciemat_api;
ALTER POLICY user_profiles_select ON public.user_profiles
  USING (auth_user_id = (SELECT app_private.current_user_id()));
REVOKE EXECUTE ON FUNCTION app_private.is_visible_profile(text) FROM tushciemat_api;
--> statement-breakpoint

CREATE FUNCTION app_private.can_view_learner_class(p_class_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.students s
    JOIN public.school_classes c ON c.id = s.class_id AND c.school_id = s.school_id
    WHERE c.id = p_class_id AND s.status = 'active'
      AND (app_private.is_student_self(s.id)
        OR (app_private.is_guardian_of(s.id) AND EXISTS (
          SELECT 1 FROM public.student_guardians sg
          JOIN public.guardians g ON g.id = sg.guardian_id AND g.school_id = sg.school_id
          WHERE sg.student_id = s.id AND sg.school_id = s.school_id
            AND g.auth_user_id = app_private.current_user_id()
            AND app_private.has_school_role(s.school_id, ARRAY['parent']::public.school_role[])
        )))
  )
$$;
REVOKE ALL ON FUNCTION app_private.can_view_learner_class(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.can_view_learner_class(uuid) TO tushciemat_api;
ALTER POLICY school_classes_select ON public.school_classes
  USING (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin', 'bursar']::public.school_role[])
         OR app_private.teaches_class(id) OR app_private.can_view_learner_class(id));
--> statement-breakpoint

CREATE POLICY school_join_requests_select ON public.school_join_requests FOR SELECT TO tushciemat_api
  USING ((auth_user_id = (SELECT app_private.current_user_id()) AND (SELECT app_private.is_active_profile()))
         OR app_private.has_school_role(school_id, ARRAY['owner', 'school_admin']::public.school_role[]));
CREATE POLICY notifications_select ON public.notifications FOR SELECT TO tushciemat_api
  USING (auth_user_id = (SELECT app_private.current_user_id()) AND (SELECT app_private.is_active_profile()));
CREATE POLICY notifications_update ON public.notifications FOR UPDATE TO tushciemat_api
  USING (auth_user_id = (SELECT app_private.current_user_id()) AND (SELECT app_private.is_active_profile()))
  WITH CHECK (auth_user_id = (SELECT app_private.current_user_id()) AND (SELECT app_private.is_active_profile()));
CREATE POLICY announcements_select ON public.announcements FOR SELECT TO tushciemat_api
  USING (app_private.is_school_member(school_id));
GRANT SELECT ON public.school_join_requests, public.notifications, public.announcements TO tushciemat_api;
GRANT UPDATE (read_at) ON public.notifications TO tushciemat_api;
--> statement-breakpoint

CREATE FUNCTION app_private.guard_notification_read()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF (to_jsonb(NEW) - 'read_at') IS DISTINCT FROM (to_jsonb(OLD) - 'read_at') THEN
    RAISE EXCEPTION 'notification contents are immutable' USING ERRCODE = '42501';
  END IF;
  NEW.read_at := CASE WHEN OLD.read_at IS NOT NULL THEN OLD.read_at
                      WHEN NEW.read_at IS NOT NULL THEN now() ELSE NULL END;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION app_private.guard_notification_read() FROM PUBLIC, tushciemat_api;
CREATE TRIGGER notifications_read_guard BEFORE UPDATE ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_notification_read();
--> statement-breakpoint

CREATE FUNCTION app_private.submit_join_request(p_school_id uuid, p_role public.school_role, p_details jsonb)
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
  -- Profile email is populated only from a Firebase-verified email by the trusted API sync.
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
  IF school.id IS NULL THEN
    RAISE EXCEPTION 'school is not available' USING ERRCODE = 'P0002';
  END IF;
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
          applicant_name, lower(profile.email), p_details)
  RETURNING * INTO result;

  INSERT INTO public.notifications (school_id, auth_user_id, type, title, body, entity_id)
    SELECT DISTINCT school.id, m.auth_user_id, 'request.submitted', 'New school join request',
           applicant_name || ' requested the ' || p_role::text || ' role.', result.id
    FROM public.school_memberships m
    JOIN public.user_profiles p ON p.auth_user_id = m.auth_user_id AND p.status = 'active'
    WHERE m.school_id = school.id AND m.status = 'active' AND m.role IN ('owner', 'school_admin');
  INSERT INTO public.audit_logs (school_id, actor_user_id, action, entity_type, entity_id, metadata)
    VALUES (school.id, actor, 'request.submitted', 'school_join_request', result.id,
            jsonb_build_object('actorUserId', actor, 'role', p_role));
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION app_private.submit_join_request(uuid, public.school_role, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.submit_join_request(uuid, public.school_role, jsonb) TO tushciemat_api;
--> statement-breakpoint

CREATE FUNCTION app_private.review_join_request(
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
  PERFORM m.id FROM public.school_memberships m
    JOIN public.user_profiles p ON p.auth_user_id = m.auth_user_id
    WHERE m.school_id = p_school_id AND m.auth_user_id = actor AND m.status = 'active'
      AND m.role IN ('owner', 'school_admin') AND p.status = 'active'
    ORDER BY m.id LIMIT 1 FOR SHARE OF m, p;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'active school manager access is required' USING ERRCODE = '42501';
  END IF;
  IF p_decision IS NULL OR p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'decision must be approved or rejected' USING ERRCODE = '22023';
  END IF;
  SELECT r.* INTO request FROM public.school_join_requests r
    WHERE r.id = p_request_id AND r.school_id = p_school_id AND r.status = 'pending' FOR UPDATE;
  IF request.id IS NULL THEN
    RAISE EXCEPTION 'pending request was not found' USING ERRCODE = 'P0002';
  END IF;
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
          student_id = NULL, guardian_id = NULL
      WHERE r.id = request.id RETURNING r.* INTO request;
  ELSE
    SELECT p.* INTO profile FROM public.user_profiles p
      WHERE p.auth_user_id = request.auth_user_id FOR UPDATE;
    IF profile.id IS NULL OR profile.status <> 'active' OR profile.email IS NULL
       OR lower(profile.email) <> request.applicant_email THEN
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
    IF request.requested_role = 'student' THEN
      IF p_student_id IS NULL THEN
        RAISE EXCEPTION 'an explicit student record is required' USING ERRCODE = '22023';
      END IF;
      UPDATE public.students s SET auth_user_id = request.auth_user_id
        WHERE s.id = p_student_id AND s.school_id = p_school_id AND s.status = 'active'
          AND (s.auth_user_id IS NULL OR s.auth_user_id = request.auth_user_id);
      IF NOT FOUND THEN
        RAISE EXCEPTION 'student record is unavailable or linked to another account' USING ERRCODE = '23514';
      END IF;
    ELSIF request.requested_role = 'parent' THEN
      IF p_guardian_id IS NULL THEN
        RAISE EXCEPTION 'an explicit guardian record is required' USING ERRCODE = '22023';
      END IF;
      SELECT g.* INTO guardian FROM public.guardians g
        WHERE g.id = p_guardian_id AND g.school_id = p_school_id FOR UPDATE;
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
    -- The conflict predicate also rejects a suspension committed during this transaction.
    INSERT INTO public.school_memberships (school_id, auth_user_id, role, status, created_by_user_id)
      VALUES (p_school_id, request.auth_user_id, request.requested_role, 'active', actor)
      ON CONFLICT (school_id, auth_user_id, role) DO UPDATE
        SET status = 'active', created_by_user_id = actor
        WHERE public.school_memberships.status = 'active'
      RETURNING id INTO membership_id;
    IF membership_id IS NULL THEN
      RAISE EXCEPTION 'suspended membership requires administrator resolution' USING ERRCODE = '42501';
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
            jsonb_build_object('actorUserId', actor, 'applicantUserId', request.auth_user_id,
                               'role', request.requested_role, 'membershipId', membership_id,
                               'studentId', request.student_id, 'guardianId', request.guardian_id,
                               'reason', request.rejection_reason));
  RETURN request;
END;
$$;
REVOKE ALL ON FUNCTION app_private.review_join_request(uuid, uuid, text, text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.review_join_request(uuid, uuid, text, text, uuid, uuid) TO tushciemat_api;
--> statement-breakpoint

CREATE FUNCTION app_private.publish_announcement(p_school_id uuid, p_title text, p_body text)
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
  PERFORM m.id FROM public.school_memberships m
    JOIN public.user_profiles p ON p.auth_user_id = m.auth_user_id
    WHERE m.school_id = p_school_id AND m.auth_user_id = actor AND m.status = 'active'
      AND m.role IN ('owner', 'school_admin') AND p.status = 'active'
    ORDER BY m.id LIMIT 1 FOR SHARE OF m, p;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'active school manager access is required' USING ERRCODE = '42501';
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
    VALUES (p_school_id, actor, 'announcement.published', 'announcement', result.id,
            jsonb_build_object('actorUserId', actor));
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION app_private.publish_announcement(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.publish_announcement(uuid, text, text) TO tushciemat_api;
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
  IF actor IS NULL THEN
    RAISE EXCEPTION 'sign in is required' USING ERRCODE = '42501';
  END IF;
  IF p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'invitation is not valid' USING ERRCODE = 'P0002';
  END IF;
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
  PERFORM m.id FROM public.school_memberships m
    JOIN public.user_profiles p ON p.auth_user_id = m.auth_user_id
    WHERE m.school_id = invite.school_id AND m.auth_user_id = invite.invited_by_user_id
      AND m.status = 'active' AND p.status = 'active'
      AND (m.role = 'owner' OR (m.role = 'school_admin' AND invite.role <> 'owner'))
    ORDER BY m.id LIMIT 1 FOR SHARE OF m, p;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'inviter no longer has authority to grant this role' USING ERRCODE = '42501';
  END IF;
  PERFORM m.id FROM public.school_memberships m
    WHERE m.school_id = invite.school_id AND m.auth_user_id = actor
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
      WHERE public.school_memberships.status = 'active'
    RETURNING id INTO new_membership_id;
  IF new_membership_id IS NULL THEN
    RAISE EXCEPTION 'suspended membership requires administrator resolution' USING ERRCODE = '42501';
  END IF;
  UPDATE public.invitations
    SET status = 'accepted', accepted_by_user_id = actor, accepted_at = now()
    WHERE id = invite.id;
  INSERT INTO public.audit_logs (school_id, actor_user_id, action, entity_type, entity_id, metadata)
    VALUES (invite.school_id, actor, 'invitation.accepted', 'invitation', invite.id,
            jsonb_build_object('role', invite.role, 'membershipId', new_membership_id));
  INSERT INTO public.notifications (school_id, auth_user_id, type, title, body, entity_id)
    SELECT DISTINCT invite.school_id, recipients.auth_user_id, 'invitation.accepted',
           'School invitation accepted', 'The ' || invite.role::text || ' invitation was accepted.', invite.id
    FROM (
      SELECT actor AS auth_user_id
      UNION
      SELECT m.auth_user_id FROM public.school_memberships m
      JOIN public.user_profiles p ON p.auth_user_id = m.auth_user_id AND p.status = 'active'
      WHERE m.school_id = invite.school_id AND m.status = 'active' AND m.role IN ('owner', 'school_admin')
    ) recipients;
  RETURN QUERY SELECT new_membership_id, invite.school_id, invite.role;
END;
$$;
REVOKE ALL ON FUNCTION app_private.accept_invitation(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.accept_invitation(text) TO tushciemat_api;
--> statement-breakpoint

CREATE FUNCTION app_private.accept_school_invitation(p_token_hash text, p_school_id uuid, p_role public.school_role)
RETURNS TABLE (membership_id uuid, school_id uuid, role public.school_role)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- The profile lock keeps the same lock order as accept_invitation and join approval.
  PERFORM p.id FROM public.user_profiles p
    WHERE p.auth_user_id = app_private.current_user_id() AND p.status = 'active' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account is not active' USING ERRCODE = '42501';
  END IF;
  PERFORM i.id FROM public.invitations i
    WHERE i.token_hash = p_token_hash AND i.school_id = p_school_id AND i.role = p_role
      AND i.status = 'pending' AND i.expires_at > now() FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invitation is not valid for the selected school and role' USING ERRCODE = 'P0002';
  END IF;
  RETURN QUERY SELECT a.membership_id, a.school_id, a.role FROM app_private.accept_invitation(p_token_hash) a;
END;
$$;
REVOKE ALL ON FUNCTION app_private.accept_school_invitation(text, uuid, public.school_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.accept_school_invitation(text, uuid, public.school_role) TO tushciemat_api;
--> statement-breakpoint

DO $$
DECLARE
  api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON public.school_join_requests, public.notifications, public.announcements FROM %I', api_role);
      EXECUTE format(
        'REVOKE ALL ON FUNCTION app_private.is_active_profile(), app_private.guard_school_metadata(), '
        'app_private.school_directory(text, uuid, integer), app_private.school_people(uuid), '
        'app_private.can_view_learner_class(uuid), app_private.guard_notification_read(), '
        'app_private.submit_join_request(uuid, public.school_role, jsonb), '
        'app_private.review_join_request(uuid, uuid, text, text, uuid, uuid), '
        'app_private.publish_announcement(uuid, text, text), app_private.accept_invitation(text), '
        'app_private.accept_school_invitation(text, uuid, public.school_role) FROM %I', api_role);
    END IF;
  END LOOP;
END;
$$;
