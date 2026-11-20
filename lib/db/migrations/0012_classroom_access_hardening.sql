-- Keep the shared API role's submission writes safe for both learners and staff.
-- Invoker security deliberately preserves RLS on assignment/student lookups.
CREATE FUNCTION app_private.guard_assignment_submission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  assignment_class_id uuid;
  assignment_max_marks integer;
  can_grade boolean;
  grading_changed boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW.id, NEW.school_id, NEW.assignment_id, NEW.student_id)
       IS DISTINCT FROM ROW(OLD.id, OLD.school_id, OLD.assignment_id, OLD.student_id) THEN
      RAISE EXCEPTION 'Submission identity cannot be changed' USING ERRCODE = '23514';
    END IF;
  END IF;

  SELECT a.class_id, a.marks_allocated
    INTO assignment_class_id, assignment_max_marks
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
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION app_private.guard_assignment_submission() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.guard_assignment_submission() TO tushciemat_api;
CREATE TRIGGER assignment_submission_guard
  BEFORE INSERT OR UPDATE ON public.assignment_submissions
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_assignment_submission();
--> statement-breakpoint

-- A restriction must match the very same linked student as the school/class.
-- NULL and [] restrictions are unrestricted; non-array JSON fails closed.
DROP POLICY learning_resources_select ON public.learning_resources;
CREATE POLICY learning_resources_select ON public.learning_resources FOR SELECT TO tushciemat_api
  USING (
    app_private.has_school_role(learning_resources.school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[])
    OR app_private.teaches_class(learning_resources.class_id)
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

-- Publication gates family reads only; staff/assigned teacher reads are retained.
-- This does not lock staff writes after publication or add subject-level scoping.
DROP POLICY student_assessment_marks_select ON public.student_assessment_marks;
CREATE POLICY student_assessment_marks_select ON public.student_assessment_marks FOR SELECT TO tushciemat_api
  USING (
    app_private.has_school_role(student_assessment_marks.school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[])
    OR EXISTS (
      SELECT 1 FROM public.assessments a
      WHERE a.id = student_assessment_marks.assessment_id AND app_private.teaches_class(a.class_id)
    )
    OR (
      (app_private.is_student_self(student_assessment_marks.student_id)
       OR app_private.is_guardian_of(student_assessment_marks.student_id))
      AND EXISTS (
        SELECT 1 FROM public.assessments a
        WHERE a.id = student_assessment_marks.assessment_id
          AND a.school_id = student_assessment_marks.school_id
          AND app_private.results_published(a.school_id, a.term_id, a.class_id)
      )
    )
  );
--> statement-breakpoint

DROP POLICY student_term_aggregates_select ON public.student_term_aggregates;
CREATE POLICY student_term_aggregates_select ON public.student_term_aggregates FOR SELECT TO tushciemat_api
  USING (
    app_private.has_school_role(student_term_aggregates.school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[])
    OR app_private.teaches_class(student_term_aggregates.class_id)
    OR (
      (app_private.is_student_self(student_term_aggregates.student_id)
       OR app_private.is_guardian_of(student_term_aggregates.student_id))
      AND app_private.results_published(student_term_aggregates.school_id, student_term_aggregates.term_id, student_term_aggregates.class_id)
    )
  );
