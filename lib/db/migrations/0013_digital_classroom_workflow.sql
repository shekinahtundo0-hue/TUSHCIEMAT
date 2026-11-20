-- Digital Classroom workflow: assignment lifecycle (draft/publish/schedule/archive/cancel),
-- material categories with multiple attachments, and subject-scoped teacher authority.

CREATE TYPE public.assignment_status AS ENUM ('draft', 'published', 'scheduled', 'archived', 'cancelled');
CREATE TYPE public.assignment_kind AS ENUM (
  'homework', 'classwork', 'individual', 'group', 'project', 'revision', 'practical');
CREATE TYPE public.resource_category AS ENUM (
  'class_notes', 'revision_notes', 'worksheet', 'reading_material', 'presentation',
  'study_guide', 'past_paper', 'other');
--> statement-breakpoint

ALTER TABLE public.assignments
  ADD COLUMN status public.assignment_status NOT NULL DEFAULT 'published',
  ADD COLUMN assignment_kind public.assignment_kind NOT NULL DEFAULT 'homework',
  ADD COLUMN published_at timestamptz,
  ADD COLUMN archived_at timestamptz,
  ADD COLUMN allow_late boolean NOT NULL DEFAULT false,
  ADD COLUMN allowed_file_types jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN topic text,
  ADD COLUMN attachments jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint

-- Every assignment that already exists was visible to its class, so it is published now.
-- The default keeps rows written before the lifecycle API consistent with the check below.
UPDATE public.assignments SET published_at = created_at WHERE published_at IS NULL;
ALTER TABLE public.assignments ALTER COLUMN published_at SET DEFAULT now();
--> statement-breakpoint

ALTER TABLE public.assignments
  ADD CONSTRAINT assignments_lifecycle_check CHECK (
    (status = 'draft' AND published_at IS NULL)
    OR (status IN ('published', 'scheduled') AND published_at IS NOT NULL)
    OR (status IN ('archived', 'cancelled'))
  ),
  ADD CONSTRAINT assignments_attachments_shape_check CHECK (
    jsonb_typeof(attachments) = 'array' AND jsonb_typeof(allowed_file_types) = 'array'
  );
--> statement-breakpoint

ALTER TABLE public.learning_resources
  ADD COLUMN subject text,
  ADD COLUMN category public.resource_category NOT NULL DEFAULT 'class_notes',
  ADD COLUMN attachments jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint

ALTER TABLE public.learning_resources
  ADD CONSTRAINT learning_resources_attachments_shape_check
    CHECK (jsonb_typeof(attachments) = 'array');
--> statement-breakpoint

ALTER TABLE public.assignment_submissions
  ADD COLUMN is_late boolean NOT NULL DEFAULT false,
  ADD COLUMN revision_history jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint

ALTER TABLE public.assignment_submissions
  ADD CONSTRAINT assignment_submissions_history_shape_check
    CHECK (jsonb_typeof(revision_history) = 'array');
--> statement-breakpoint

CREATE INDEX assignments_class_status_idx ON public.assignments(school_id, class_id, status);
CREATE INDEX learning_resources_class_category_idx ON public.learning_resources(school_id, class_id, category);
--> statement-breakpoint

-- Teachers are bounded by the subjects they actually teach. A class teacher has one
-- assignment with no subject and therefore keeps the whole class; a subject teacher is
-- limited to rows matching their subject. Legacy rows with no subject stay reachable.
CREATE OR REPLACE FUNCTION app_private.teaches_subject(p_class_id uuid, p_subject text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT app_private.teaches_class(p_class_id) AND (
    p_subject IS NULL
    OR EXISTS (
      SELECT 1 FROM public.class_teacher_assignments a
      WHERE a.class_id = p_class_id
        AND a.teacher_user_id = app_private.current_user_id()
        AND (a.assignment_role = 'class_teacher' OR a.subject = p_subject)
    )
  )
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION app_private.teaches_subject(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.teaches_subject(uuid, text) TO tushciemat_api;
--> statement-breakpoint

-- Learners and guardians only ever see published assignments whose time has arrived.
-- A scheduled assignment opens on its own once its publication moment passes.
DROP POLICY assignments_select ON public.assignments;
CREATE POLICY assignments_select ON public.assignments FOR SELECT TO tushciemat_api
  USING (
    app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[])
    OR app_private.teaches_class(class_id)
    OR (
      status IN ('published', 'scheduled')
      AND published_at <= now()
      AND (app_private.is_class_learner(class_id) OR app_private.is_guardian_of_class_learner(class_id))
    )
  );
--> statement-breakpoint

DROP POLICY assignments_insert ON public.assignments;
CREATE POLICY assignments_insert ON public.assignments FOR INSERT TO tushciemat_api
  WITH CHECK (
    app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[])
    OR app_private.teaches_subject(class_id, subject)
  );
--> statement-breakpoint

DROP POLICY assignments_update ON public.assignments;
CREATE POLICY assignments_update ON public.assignments FOR UPDATE TO tushciemat_api
  USING (
    app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[])
    OR app_private.teaches_subject(class_id, subject)
  )
  WITH CHECK (
    app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[])
    OR app_private.teaches_subject(class_id, subject)
  );
--> statement-breakpoint

DROP POLICY learning_resources_select ON public.learning_resources;
CREATE POLICY learning_resources_select ON public.learning_resources FOR SELECT TO tushciemat_api
  USING (
    app_private.has_school_role(learning_resources.school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[])
    OR app_private.teaches_subject(learning_resources.class_id, learning_resources.subject)
    OR (
      learning_resources.published_at IS NOT NULL
      AND learning_resources.published_at <= now()
      AND learning_resources.is_visible_to_students
      AND learning_resources.deleted_at IS NULL
      AND (learning_resources.expires_at IS NULL OR learning_resources.expires_at > now())
      AND EXISTS (
        SELECT 1 FROM public.students s
        WHERE s.school_id = learning_resources.school_id
          AND s.class_id = learning_resources.class_id
          AND (app_private.is_student_self(s.id) OR app_private.is_guardian_of(s.id))
          AND (
            learning_resources.restricted_to_student_ids IS NULL
            OR learning_resources.restricted_to_student_ids = '[]'::jsonb
            OR (jsonb_typeof(learning_resources.restricted_to_student_ids) = 'array'
                AND learning_resources.restricted_to_student_ids @> jsonb_build_array(s.id::text))
          )
      )
    )
  );
--> statement-breakpoint

DROP POLICY learning_resources_insert ON public.learning_resources;
CREATE POLICY learning_resources_insert ON public.learning_resources FOR INSERT TO tushciemat_api
  WITH CHECK (
    app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[])
    OR app_private.teaches_subject(class_id, subject)
  );
--> statement-breakpoint

DROP POLICY learning_resources_update ON public.learning_resources;
CREATE POLICY learning_resources_update ON public.learning_resources FOR UPDATE TO tushciemat_api
  USING (
    app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[])
    OR app_private.teaches_subject(class_id, subject)
  )
  WITH CHECK (
    app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[])
    OR app_private.teaches_subject(class_id, subject)
  );
--> statement-breakpoint

-- Replaces the submission guard from 0012 to also require a published assignment.
CREATE OR REPLACE FUNCTION app_private.guard_assignment_submission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  assignment_class_id uuid;
  assignment_max_marks integer;
  assignment_public boolean;
  can_grade boolean;
  grading_changed boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW.id, NEW.school_id, NEW.assignment_id, NEW.student_id)
       IS DISTINCT FROM ROW(OLD.id, OLD.school_id, OLD.assignment_id, OLD.student_id) THEN
      RAISE EXCEPTION 'Submission identity cannot be changed' USING ERRCODE = '23514';
    END IF;
  END IF;

  -- Mirrors assignments_select: a scheduled assignment becomes live once its publication time arrives.
  SELECT a.class_id, a.marks_allocated,
         a.status IN ('published', 'scheduled') AND a.published_at <= now()
    INTO assignment_class_id, assignment_max_marks, assignment_public
    FROM public.assignments a
    WHERE a.id = NEW.assignment_id AND a.school_id = NEW.school_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Submission must reference a student and assignment in the same school and class'
      USING ERRCODE = '23514';
  END IF;

  -- Enrollment is checked on creation only; immutable submissions survive class transfers.
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.id = NEW.student_id AND s.school_id = NEW.school_id
        AND s.class_id = assignment_class_id
    ) THEN
      RAISE EXCEPTION 'Submission must reference a student and assignment in the same school and class'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.marks_obtained IS NOT NULL
     AND (NEW.marks_obtained < 0 OR NEW.marks_obtained > assignment_max_marks) THEN
    RAISE EXCEPTION 'Submission marks must be between zero and the assignment maximum'
      USING ERRCODE = '23514';
  END IF;

  can_grade := COALESCE(
    app_private.has_school_capability(NEW.school_id, 'classroom.manage')
    OR app_private.teaches_class(assignment_class_id), false);

  IF TG_OP = 'INSERT' THEN
    grading_changed := NEW.marks_obtained IS NOT NULL OR NEW.feedback IS NOT NULL
      OR NEW.marked_at IS NOT NULL OR NEW.graded_by_user_id IS NOT NULL
      OR NEW.status = 'graded';
  ELSE
    IF NOT can_grade AND (OLD.status = 'graded' OR OLD.marks_obtained IS NOT NULL
       OR OLD.marked_at IS NOT NULL OR OLD.graded_by_user_id IS NOT NULL) THEN
      RAISE EXCEPTION 'Learners cannot modify graded submissions' USING ERRCODE = '42501';
    END IF;
    grading_changed := ROW(NEW.marks_obtained, NEW.feedback, NEW.marked_at, NEW.graded_by_user_id)
      IS DISTINCT FROM ROW(OLD.marks_obtained, OLD.feedback, OLD.marked_at, OLD.graded_by_user_id)
      OR (NEW.status IS DISTINCT FROM OLD.status AND (NEW.status = 'graded' OR OLD.status = 'graded'));
  END IF;

  IF grading_changed THEN
    IF NOT can_grade THEN
      RAISE EXCEPTION 'Only classroom managers or assigned teachers may grade submissions'
        USING ERRCODE = '42501';
    END IF;
    IF app_private.current_user_id() IS NULL
       OR NEW.graded_by_user_id IS DISTINCT FROM app_private.current_user_id() THEN
      RAISE EXCEPTION 'Submission grader must be the current user' USING ERRCODE = '42501';
    END IF;
  ELSIF NOT assignment_public THEN
    -- Drafts, not-yet-due scheduled work, archived and cancelled assignments take no learner work.
    RAISE EXCEPTION 'Submissions are only accepted for published assignments' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$$;
--> statement-breakpoint

-- Classroom notifications reach the linked learner and guardian accounts of a class.
-- The API role cannot insert notifications directly, so fan-out stays in a guarded routine.
CREATE OR REPLACE FUNCTION app_private.notify_class(
  p_school_id uuid, p_class_id uuid, p_type text, p_title text, p_body text, p_entity_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  recipient_count integer := 0;
BEGIN
  IF btrim(p_type) = '' OR char_length(p_type) > 60
     OR btrim(p_title) = '' OR char_length(p_title) > 200
     OR btrim(p_body) = '' OR char_length(p_body) > 2000 THEN
    RAISE EXCEPTION 'Notification type, title and body must be short, non-empty text'
      USING ERRCODE = '22023';
  END IF;
  IF NOT (app_private.has_school_capability(p_school_id, 'classroom.manage')
          OR app_private.teaches_class(p_class_id)) THEN
    RAISE EXCEPTION 'Only classroom managers or assigned teachers may notify this class'
      USING ERRCODE = '42501';
  END IF;

  WITH audience AS (
    SELECT DISTINCT linked.auth_user_id
    FROM (
      SELECT s.auth_user_id FROM public.students s
       WHERE s.school_id = p_school_id AND s.class_id = p_class_id AND s.auth_user_id IS NOT NULL
      UNION ALL
      SELECT g.auth_user_id FROM public.students s
       JOIN public.student_guardians sg ON sg.student_id = s.id
       JOIN public.guardians g ON g.id = sg.guardian_id
      WHERE s.school_id = p_school_id AND s.class_id = p_class_id AND g.auth_user_id IS NOT NULL
    ) linked
    JOIN public.user_profiles p ON p.auth_user_id = linked.auth_user_id AND p.status = 'active'
  )
  INSERT INTO public.notifications (school_id, auth_user_id, type, title, body, entity_id)
  SELECT p_school_id, audience.auth_user_id, p_type, p_title, p_body, p_entity_id FROM audience;
  GET DIAGNOSTICS recipient_count = ROW_COUNT;
  RETURN recipient_count;
END
$$;
REVOKE ALL ON FUNCTION app_private.notify_class(uuid, uuid, text, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.notify_class(uuid, uuid, text, text, text, uuid) TO tushciemat_api;
--> statement-breakpoint

-- Grading a single learner's work notifies that learner and their guardians only.
CREATE OR REPLACE FUNCTION app_private.notify_student(
  p_school_id uuid, p_student_id uuid, p_type text, p_title text, p_body text, p_entity_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  student_class uuid;
  recipient_count integer := 0;
BEGIN
  IF btrim(p_type) = '' OR char_length(p_type) > 60
     OR btrim(p_title) = '' OR char_length(p_title) > 200
     OR btrim(p_body) = '' OR char_length(p_body) > 2000 THEN
    RAISE EXCEPTION 'Notification type, title and body must be short, non-empty text'
      USING ERRCODE = '22023';
  END IF;
  SELECT s.class_id INTO student_class FROM public.students s
   WHERE s.id = p_student_id AND s.school_id = p_school_id;
  IF student_class IS NULL THEN
    RAISE EXCEPTION 'Learner not found in this school' USING ERRCODE = 'P0002';
  END IF;
  IF NOT (app_private.has_school_capability(p_school_id, 'classroom.manage')
          OR app_private.teaches_class(student_class)) THEN
    RAISE EXCEPTION 'Only classroom managers or assigned teachers may notify this learner'
      USING ERRCODE = '42501';
  END IF;

  WITH audience AS (
    SELECT DISTINCT linked.auth_user_id
    FROM (
      SELECT s.auth_user_id FROM public.students s
       WHERE s.id = p_student_id AND s.auth_user_id IS NOT NULL
      UNION ALL
      SELECT g.auth_user_id FROM public.student_guardians sg
       JOIN public.guardians g ON g.id = sg.guardian_id
      WHERE sg.student_id = p_student_id AND g.auth_user_id IS NOT NULL
    ) linked
    JOIN public.user_profiles p ON p.auth_user_id = linked.auth_user_id AND p.status = 'active'
  )
  INSERT INTO public.notifications (school_id, auth_user_id, type, title, body, entity_id)
  SELECT p_school_id, audience.auth_user_id, p_type, p_title, p_body, p_entity_id FROM audience;
  GET DIAGNOSTICS recipient_count = ROW_COUNT;
  RETURN recipient_count;
END
$$;
REVOKE ALL ON FUNCTION app_private.notify_student(uuid, uuid, text, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.notify_student(uuid, uuid, text, text, text, uuid) TO tushciemat_api;
--> statement-breakpoint

-- Markers need the class roster to see who has not submitted, without gaining
-- access to the learner directory as a whole.
CREATE OR REPLACE FUNCTION app_private.assignment_roster(p_school_id uuid, p_assignment_id uuid)
RETURNS TABLE (student_id uuid, full_name text, admission_number text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT s.id,
         btrim(s.first_name || ' ' || s.last_name),
         s.admission_number
  FROM public.assignments a
  JOIN public.students s ON s.school_id = a.school_id AND s.class_id = a.class_id
  WHERE a.id = p_assignment_id
    AND a.school_id = p_school_id
    AND (app_private.has_school_capability(a.school_id, 'classroom.manage')
         OR app_private.teaches_class(a.class_id))
  ORDER BY s.admission_number NULLS LAST, btrim(s.first_name || ' ' || s.last_name)
$$;
REVOKE ALL ON FUNCTION app_private.assignment_roster(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.assignment_roster(uuid, uuid) TO tushciemat_api;
