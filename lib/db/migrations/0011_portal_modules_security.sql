-- Portal modules security layer.
-- 1. Creates the three tables the classroom/assignment routers need but no
--    earlier migration defined (assignments, assignment_submissions,
--    class_timetables), matching lib/db/src/schema/assignments.ts exactly.
-- 2. Adds the classroom.manage capability used by the new routers.
-- 3. Grants least-privilege access to tushciemat_api and enables row-level
--    security on every table introduced by migrations 0006-0009 plus the
--    tables above. Policies mirror the existing 0001/0003/0005 patterns:
--    tenant isolation first, then role/relationship-scoped access.

CREATE TABLE public.assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES public.school_classes(id) ON DELETE CASCADE,
  subject text NOT NULL,
  title text NOT NULL,
  description text,
  instructions jsonb NOT NULL DEFAULT '[]',
  attached_resource_ids jsonb NOT NULL DEFAULT '[]',
  marks_allocated integer NOT NULL,
  deadline_date date NOT NULL,
  deadline_time time,
  allow_resubmission boolean NOT NULL DEFAULT false,
  created_by_user_id text NOT NULL REFERENCES public.user_profiles(auth_user_id),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT assignments_marks_check CHECK (marks_allocated > 0)
);
CREATE INDEX assignments_school_class_idx ON public.assignments(school_id, class_id);
CREATE UNIQUE INDEX assignments_class_subject_title_unique ON public.assignments(class_id, subject, title);
--> statement-breakpoint

CREATE TYPE public.assignment_submission_status AS ENUM ('not_started', 'in_progress', 'submitted', 'graded', 'overdue');
--> statement-breakpoint

CREATE TABLE public.assignment_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  assignment_id uuid NOT NULL REFERENCES public.assignments(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  submission_text text,
  submitted_files jsonb NOT NULL DEFAULT '[]',
  submitted_at timestamp with time zone,
  marked_at timestamp with time zone,
  marks_obtained numeric(8,2),
  feedback text,
  graded_by_user_id text REFERENCES public.user_profiles(auth_user_id),
  status public.assignment_submission_status NOT NULL DEFAULT 'not_started',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT assignment_submissions_marks_check CHECK (marks_obtained IS NULL OR marks_obtained >= 0)
);
CREATE UNIQUE INDEX assignment_submissions_unique ON public.assignment_submissions(assignment_id, student_id);
CREATE INDEX assignment_submissions_assignment_idx ON public.assignment_submissions(assignment_id);
CREATE INDEX assignment_submissions_student_idx ON public.assignment_submissions(student_id);
CREATE INDEX assignment_submissions_status_idx ON public.assignment_submissions(status);
--> statement-breakpoint

CREATE TABLE public.class_timetables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES public.school_classes(id) ON DELETE CASCADE,
  day_of_week integer NOT NULL,
  period_number integer NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  subject text NOT NULL,
  teacher_user_id text NOT NULL REFERENCES public.user_profiles(auth_user_id),
  room_location text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT class_timetables_day_check CHECK (day_of_week >= 0 AND day_of_week <= 6),
  CONSTRAINT class_timetables_time_check CHECK (start_time < end_time)
);
CREATE UNIQUE INDEX class_timetables_unique ON public.class_timetables(class_id, day_of_week, period_number);
CREATE INDEX class_timetables_class_day_idx ON public.class_timetables(class_id, day_of_week);
--> statement-breakpoint

ALTER TYPE public.school_capability ADD VALUE IF NOT EXISTS 'classroom.manage' BEFORE 'records.delete';
--> statement-breakpoint

-- Principals and academic administrators implicitly hold classroom.manage,
-- mirroring their existing academic capabilities. Teachers never hold
-- capabilities; their classroom writes are scoped by teaches_class() in the
-- policies below and by scopedRoles at the API gate.
CREATE OR REPLACE FUNCTION app_private.user_has_school_capability(p_school uuid, p_user text, p_capability text)
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
            'assessments.manage', 'results.publish', 'resources.manage',
            'classroom.manage'))
          OR (m.role = 'school_admin' AND EXISTS (
            SELECT 1 FROM public.membership_capabilities c
            WHERE c.membership_id = m.id AND c.school_id = m.school_id
              AND c.capability::text = p_capability)))
    )
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Helpers. SECURITY DEFINER, pinned search_path, membership-checked.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.is_class_learner(p_class_id uuid)
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
    WHERE s.class_id = p_class_id
      AND s.auth_user_id = app_private.current_user_id()
  )
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_private.is_guardian_of_class_learner(p_class_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.students s
    JOIN public.student_guardians sg ON sg.student_id = s.id
    JOIN public.guardians g ON g.id = sg.guardian_id
    JOIN public.school_memberships m
      ON m.school_id = g.school_id
     AND m.auth_user_id = g.auth_user_id
     AND m.role = 'parent'
     AND m.status = 'active'
    JOIN public.user_profiles p ON p.auth_user_id = m.auth_user_id AND p.status = 'active'
    WHERE s.class_id = p_class_id
      AND g.auth_user_id = app_private.current_user_id()
  )
$$;
--> statement-breakpoint

-- Publication check usable by learner accounts without exposing the
-- staff-only result_publications workflow rows.
CREATE OR REPLACE FUNCTION app_private.results_published(p_school_id uuid, p_term_id uuid, p_class_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT app_private.is_school_member(p_school_id)
    AND EXISTS (
      SELECT 1
      FROM public.result_publications rp
      WHERE rp.school_id = p_school_id
        AND rp.term_id = p_term_id
        AND rp.status = 'published'
        AND (rp.class_id IS NULL OR rp.class_id = p_class_id)
    )
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION app_private.is_class_learner(uuid), app_private.is_guardian_of_class_learner(uuid), app_private.results_published(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.is_class_learner(uuid), app_private.is_guardian_of_class_learner(uuid), app_private.results_published(uuid, uuid, uuid) TO tushciemat_api;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Grants: least privilege per table. Column-scoped UPDATE where learners may
-- only touch their own content, never marks or workflow fields.
-- ---------------------------------------------------------------------------

GRANT SELECT ON public.class_lessons, public.learning_resources, public.resource_access_logs, public.student_learning_progress TO tushciemat_api;
GRANT INSERT, UPDATE, DELETE ON public.class_lessons TO tushciemat_api;
GRANT INSERT, UPDATE ON public.learning_resources TO tushciemat_api;
GRANT INSERT ON public.resource_access_logs TO tushciemat_api;
GRANT INSERT ON public.student_learning_progress TO tushciemat_api;
GRANT UPDATE (completed_at, bookmarked_at) ON public.student_learning_progress TO tushciemat_api;
--> statement-breakpoint

GRANT SELECT ON public.assignments TO tushciemat_api;
GRANT INSERT, UPDATE, DELETE ON public.assignments TO tushciemat_api;
GRANT SELECT ON public.assignment_submissions TO tushciemat_api;
GRANT INSERT ON public.assignment_submissions TO tushciemat_api;
GRANT UPDATE (submission_text, submitted_files, submitted_at, status, updated_at) ON public.assignment_submissions TO tushciemat_api;
GRANT UPDATE ON public.assignment_submissions TO tushciemat_api;
GRANT SELECT ON public.class_timetables TO tushciemat_api;
GRANT INSERT, UPDATE, DELETE ON public.class_timetables TO tushciemat_api;
--> statement-breakpoint

GRANT SELECT ON public.assessment_types, public.assessments, public.student_assessment_marks, public.grading_scales, public.student_term_aggregates TO tushciemat_api;
GRANT INSERT, UPDATE, DELETE ON public.assessment_types TO tushciemat_api;
GRANT INSERT, UPDATE, DELETE ON public.assessments TO tushciemat_api;
GRANT INSERT, UPDATE, DELETE ON public.student_assessment_marks TO tushciemat_api;
GRANT INSERT, UPDATE, DELETE ON public.grading_scales TO tushciemat_api;
GRANT INSERT, UPDATE, DELETE ON public.student_term_aggregates TO tushciemat_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.result_publications TO tushciemat_api;
--> statement-breakpoint

GRANT SELECT ON public.announcements_extended, public.announcement_attachments, public.announcement_deliveries, public.direct_messages TO tushciemat_api;
GRANT INSERT, UPDATE, DELETE ON public.announcements_extended TO tushciemat_api;
GRANT INSERT, DELETE ON public.announcement_attachments TO tushciemat_api;
GRANT INSERT ON public.announcement_deliveries TO tushciemat_api;
GRANT UPDATE (read_at, delivery_status) ON public.announcement_deliveries TO tushciemat_api;
GRANT INSERT ON public.direct_messages TO tushciemat_api;
GRANT UPDATE (message_body, deleted_at, updated_at) ON public.direct_messages TO tushciemat_api;
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_employment_records TO tushciemat_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.teacher_workload TO tushciemat_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.class_timeslots TO tushciemat_api;
GRANT SELECT, INSERT ON public.teacher_leave_requests TO tushciemat_api;
GRANT UPDATE ON public.teacher_leave_requests TO tushciemat_api;
GRANT SELECT, INSERT, UPDATE ON public.teacher_leave_balances TO tushciemat_api;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Row-level security. Every policy is scoped TO tushciemat_api; the role is
-- NOBYPASSRLS, so these are the only rows the API can ever see.
-- ---------------------------------------------------------------------------

ALTER TABLE public.class_lessons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resource_access_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_learning_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignment_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_timetables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessment_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_assessment_marks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grading_scales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.result_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_term_aggregates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcements_extended ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcement_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcement_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.direct_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_employment_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teacher_workload ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_timeslots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teacher_leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teacher_leave_balances ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Classroom: staff manage; teachers manage their own classes; learners and
-- their guardians read their class. Resource reads for learners are limited
-- to published, unexpired, student-visible rows.
CREATE POLICY class_lessons_select ON public.class_lessons FOR SELECT TO tushciemat_api
  USING (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[])
         OR app_private.teaches_class(class_id)
         OR app_private.is_class_learner(class_id)
         OR app_private.is_guardian_of_class_learner(class_id));
CREATE POLICY class_lessons_write ON public.class_lessons FOR INSERT TO tushciemat_api
  WITH CHECK (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[])
              OR app_private.teaches_class(class_id));
CREATE POLICY class_lessons_update ON public.class_lessons FOR UPDATE TO tushciemat_api
  USING (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[])
         OR app_private.teaches_class(class_id))
  WITH CHECK (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[])
              OR app_private.teaches_class(class_id));
CREATE POLICY class_lessons_delete ON public.class_lessons FOR DELETE TO tushciemat_api
  USING (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[])
         OR app_private.teaches_class(class_id));
--> statement-breakpoint

CREATE POLICY learning_resources_select ON public.learning_resources FOR SELECT TO tushciemat_api
  USING (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[])
         OR app_private.teaches_class(class_id)
         OR ((app_private.is_class_learner(class_id) OR app_private.is_guardian_of_class_learner(class_id))
             AND is_visible_to_students AND deleted_at IS NULL
             AND (published_at IS NULL OR published_at <= now())
             AND (expires_at IS NULL OR expires_at > now())));
CREATE POLICY learning_resources_insert ON public.learning_resources FOR INSERT TO tushciemat_api
  WITH CHECK (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[])
              OR app_private.teaches_class(class_id));
CREATE POLICY learning_resources_update ON public.learning_resources FOR UPDATE TO tushciemat_api
  USING (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[])
         OR app_private.teaches_class(class_id))
  WITH CHECK (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[])
              OR app_private.teaches_class(class_id));
--> statement-breakpoint

CREATE POLICY resource_access_logs_select ON public.resource_access_logs FOR SELECT TO tushciemat_api
  USING (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[])
         OR app_private.is_student_self(student_id)
         OR app_private.is_guardian_of(student_id)
         OR EXISTS (SELECT 1 FROM public.learning_resources r
                    WHERE r.id = resource_id AND app_private.teaches_class(r.class_id)));
CREATE POLICY resource_access_logs_insert ON public.resource_access_logs FOR INSERT TO tushciemat_api
  WITH CHECK (app_private.is_student_self(student_id)
              AND EXISTS (SELECT 1 FROM public.learning_resources r
                          WHERE r.id = resource_id AND r.school_id = school_id));
--> statement-breakpoint

CREATE POLICY student_learning_progress_select ON public.student_learning_progress FOR SELECT TO tushciemat_api
  USING (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[])
         OR app_private.is_student_self(student_id)
         OR app_private.is_guardian_of(student_id)
         OR app_private.teaches_class(class_id));
CREATE POLICY student_learning_progress_insert ON public.student_learning_progress FOR INSERT TO tushciemat_api
  WITH CHECK (app_private.is_student_self(student_id));
CREATE POLICY student_learning_progress_update ON public.student_learning_progress FOR UPDATE TO tushciemat_api
  USING (app_private.is_student_self(student_id)
         OR app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[]))
  WITH CHECK (app_private.is_student_self(student_id)
              OR app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[]));
--> statement-breakpoint

-- Assignments: class-scoped reads for learners/guardians; staff and the
-- class's teachers manage. Submissions: learners write only their own rows
-- (column grants keep marks/feedback staff-only); staff and the class's
-- teachers read and grade.
CREATE POLICY assignments_select ON public.assignments FOR SELECT TO tushciemat_api
  USING (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[])
         OR app_private.teaches_class(class_id)
         OR app_private.is_class_learner(class_id)
         OR app_private.is_guardian_of_class_learner(class_id));
CREATE POLICY assignments_insert ON public.assignments FOR INSERT TO tushciemat_api
  WITH CHECK (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[])
              OR app_private.teaches_class(class_id));
CREATE POLICY assignments_update ON public.assignments FOR UPDATE TO tushciemat_api
  USING (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[])
         OR app_private.teaches_class(class_id))
  WITH CHECK (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[])
              OR app_private.teaches_class(class_id));
CREATE POLICY assignments_delete ON public.assignments FOR DELETE TO tushciemat_api
  USING (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[]));
--> statement-breakpoint

CREATE POLICY assignment_submissions_select ON public.assignment_submissions FOR SELECT TO tushciemat_api
  USING (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[])
         OR app_private.is_student_self(student_id)
         OR app_private.is_guardian_of(student_id)
         OR EXISTS (SELECT 1 FROM public.assignments a
                    WHERE a.id = assignment_id AND app_private.teaches_class(a.class_id)));
CREATE POLICY assignment_submissions_insert ON public.assignment_submissions FOR INSERT TO tushciemat_api
  WITH CHECK (app_private.is_student_self(student_id)
              AND EXISTS (SELECT 1 FROM public.assignments a
                          WHERE a.id = assignment_id AND a.school_id = school_id AND a.class_id = (SELECT s.class_id FROM public.students s WHERE s.id = student_id)));
CREATE POLICY assignment_submissions_update ON public.assignment_submissions FOR UPDATE TO tushciemat_api
  USING (app_private.is_student_self(student_id)
         OR app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[])
         OR EXISTS (SELECT 1 FROM public.assignments a
                    WHERE a.id = assignment_id AND app_private.teaches_class(a.class_id)))
  WITH CHECK (app_private.is_student_self(student_id)
              OR app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[])
              OR EXISTS (SELECT 1 FROM public.assignments a
                         WHERE a.id = assignment_id AND app_private.teaches_class(a.class_id)));
--> statement-breakpoint

CREATE POLICY class_timetables_select ON public.class_timetables FOR SELECT TO tushciemat_api
  USING (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[])
         OR app_private.teaches_class(class_id)
         OR app_private.is_class_learner(class_id)
         OR app_private.is_guardian_of_class_learner(class_id));
CREATE POLICY class_timetables_insert ON public.class_timetables FOR INSERT TO tushciemat_api
  WITH CHECK (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[]));
CREATE POLICY class_timetables_update ON public.class_timetables FOR UPDATE TO tushciemat_api
  USING (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[]))
  WITH CHECK (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[]));
CREATE POLICY class_timetables_delete ON public.class_timetables FOR DELETE TO tushciemat_api
  USING (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[]));
--> statement-breakpoint

-- Results: reference data readable by members; marks and aggregates are
-- self/guardian/staff/teacher scoped. Publication workflow rows are
-- staff-only; learners use app_private.results_published() instead.
CREATE POLICY assessment_types_select ON public.assessment_types FOR SELECT TO tushciemat_api
  USING (app_private.is_school_member(school_id));
CREATE POLICY assessment_types_write ON public.assessment_types FOR INSERT TO tushciemat_api
  WITH CHECK (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[]));
CREATE POLICY assessment_types_update ON public.assessment_types FOR UPDATE TO tushciemat_api
  USING (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[]))
  WITH CHECK (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[]));
CREATE POLICY assessment_types_delete ON public.assessment_types FOR DELETE TO tushciemat_api
  USING (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[]));
--> statement-breakpoint

CREATE POLICY assessments_select ON public.assessments FOR SELECT TO tushciemat_api
  USING (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[])
         OR app_private.teaches_class(class_id)
         OR app_private.is_class_learner(class_id)
         OR app_private.is_guardian_of_class_learner(class_id));
CREATE POLICY assessments_insert ON public.assessments FOR INSERT TO tushciemat_api
  WITH CHECK (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[])
              OR app_private.teaches_class(class_id));
CREATE POLICY assessments_update ON public.assessments FOR UPDATE TO tushciemat_api
  USING (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[])
         OR app_private.teaches_class(class_id))
  WITH CHECK (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[])
              OR app_private.teaches_class(class_id));
CREATE POLICY assessments_delete ON public.assessments FOR DELETE TO tushciemat_api
  USING (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[]));
--> statement-breakpoint

CREATE POLICY student_assessment_marks_select ON public.student_assessment_marks FOR SELECT TO tushciemat_api
  USING (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[])
         OR app_private.is_student_self(student_id)
         OR app_private.is_guardian_of(student_id)
         OR EXISTS (SELECT 1 FROM public.assessments a
                    WHERE a.id = assessment_id AND app_private.teaches_class(a.class_id)));
CREATE POLICY student_assessment_marks_insert ON public.student_assessment_marks FOR INSERT TO tushciemat_api
  WITH CHECK (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[])
              OR EXISTS (SELECT 1 FROM public.assessments a
                         WHERE a.id = assessment_id AND a.school_id = school_id
                           AND app_private.teaches_class(a.class_id)));
CREATE POLICY student_assessment_marks_update ON public.student_assessment_marks FOR UPDATE TO tushciemat_api
  USING (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[])
         OR EXISTS (SELECT 1 FROM public.assessments a
                    WHERE a.id = assessment_id AND app_private.teaches_class(a.class_id)))
  WITH CHECK (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[])
              OR EXISTS (SELECT 1 FROM public.assessments a
                         WHERE a.id = assessment_id AND app_private.teaches_class(a.class_id)));
CREATE POLICY student_assessment_marks_delete ON public.student_assessment_marks FOR DELETE TO tushciemat_api
  USING (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[]));
--> statement-breakpoint

CREATE POLICY grading_scales_select ON public.grading_scales FOR SELECT TO tushciemat_api
  USING (app_private.is_school_member(school_id));
CREATE POLICY grading_scales_insert ON public.grading_scales FOR INSERT TO tushciemat_api
  WITH CHECK (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[]));
CREATE POLICY grading_scales_update ON public.grading_scales FOR UPDATE TO tushciemat_api
  USING (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[]))
  WITH CHECK (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[]));
CREATE POLICY grading_scales_delete ON public.grading_scales FOR DELETE TO tushciemat_api
  USING (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[]));
--> statement-breakpoint

CREATE POLICY result_publications_select ON public.result_publications FOR SELECT TO tushciemat_api
  USING (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[]));
CREATE POLICY result_publications_insert ON public.result_publications FOR INSERT TO tushciemat_api
  WITH CHECK (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[])
              AND app_private.has_school_capability(school_id, 'results.publish'));
CREATE POLICY result_publications_update ON public.result_publications FOR UPDATE TO tushciemat_api
  USING (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[])
         AND app_private.has_school_capability(school_id, 'results.publish'))
  WITH CHECK (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[])
              AND app_private.has_school_capability(school_id, 'results.publish'));
CREATE POLICY result_publications_delete ON public.result_publications FOR DELETE TO tushciemat_api
  USING (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[]));
--> statement-breakpoint

CREATE POLICY student_term_aggregates_select ON public.student_term_aggregates FOR SELECT TO tushciemat_api
  USING (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[])
         OR app_private.is_student_self(student_id)
         OR app_private.is_guardian_of(student_id)
         OR app_private.teaches_class(class_id));
CREATE POLICY student_term_aggregates_insert ON public.student_term_aggregates FOR INSERT TO tushciemat_api
  WITH CHECK (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[]));
CREATE POLICY student_term_aggregates_update ON public.student_term_aggregates FOR UPDATE TO tushciemat_api
  USING (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[]))
  WITH CHECK (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[]));
CREATE POLICY student_term_aggregates_delete ON public.student_term_aggregates FOR DELETE TO tushciemat_api
  USING (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[]));
--> statement-breakpoint

-- Communications: extended announcements are staff-managed; members read
-- published, unexpired rows. Deliveries are recipient-scoped. Direct messages
-- are strictly sender/recipient. (Audience targeting refinement is Stage 2.)
CREATE POLICY announcements_extended_select ON public.announcements_extended FOR SELECT TO tushciemat_api
  USING (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[])
         OR (app_private.is_school_member(school_id)
             AND is_published
             AND (expires_at IS NULL OR expires_at > now())));
CREATE POLICY announcements_extended_insert ON public.announcements_extended FOR INSERT TO tushciemat_api
  WITH CHECK (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[])
              AND author_user_id = (SELECT app_private.current_user_id()));
CREATE POLICY announcements_extended_update ON public.announcements_extended FOR UPDATE TO tushciemat_api
  USING (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[]))
  WITH CHECK (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[]));
CREATE POLICY announcements_extended_delete ON public.announcements_extended FOR DELETE TO tushciemat_api
  USING (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[]));
--> statement-breakpoint

CREATE POLICY announcement_attachments_select ON public.announcement_attachments FOR SELECT TO tushciemat_api
  USING (EXISTS (SELECT 1 FROM public.announcements_extended a
                 WHERE a.id = announcement_id
                   AND (app_private.has_school_role(a.school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[])
                        OR (app_private.is_school_member(a.school_id) AND a.is_published
                            AND (a.expires_at IS NULL OR a.expires_at > now())))));
CREATE POLICY announcement_attachments_insert ON public.announcement_attachments FOR INSERT TO tushciemat_api
  WITH CHECK (EXISTS (SELECT 1 FROM public.announcements_extended a
                      WHERE a.id = announcement_id
                        AND app_private.has_school_role(a.school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[])));
CREATE POLICY announcement_attachments_delete ON public.announcement_attachments FOR DELETE TO tushciemat_api
  USING (EXISTS (SELECT 1 FROM public.announcements_extended a
                 WHERE a.id = announcement_id
                   AND app_private.has_school_role(a.school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[])));
--> statement-breakpoint

CREATE POLICY announcement_deliveries_select ON public.announcement_deliveries FOR SELECT TO tushciemat_api
  USING (recipient_user_id = (SELECT app_private.current_user_id())
         OR app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[]));
CREATE POLICY announcement_deliveries_insert ON public.announcement_deliveries FOR INSERT TO tushciemat_api
  WITH CHECK (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[]));
CREATE POLICY announcement_deliveries_update ON public.announcement_deliveries FOR UPDATE TO tushciemat_api
  USING (recipient_user_id = (SELECT app_private.current_user_id())
         OR app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[]))
  WITH CHECK (recipient_user_id = (SELECT app_private.current_user_id())
              OR app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[]));
--> statement-breakpoint

CREATE POLICY direct_messages_select ON public.direct_messages FOR SELECT TO tushciemat_api
  USING (app_private.is_school_member(school_id)
         AND (sender_user_id = (SELECT app_private.current_user_id())
              OR recipient_user_id = (SELECT app_private.current_user_id())
              OR (recipient_class_id IS NOT NULL
                  AND (app_private.is_class_learner(recipient_class_id)
                       OR app_private.teaches_class(recipient_class_id)
                       OR app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[])))));
CREATE POLICY direct_messages_insert ON public.direct_messages FOR INSERT TO tushciemat_api
  WITH CHECK (app_private.is_school_member(school_id)
              AND sender_user_id = (SELECT app_private.current_user_id()));
CREATE POLICY direct_messages_update ON public.direct_messages FOR UPDATE TO tushciemat_api
  USING (sender_user_id = (SELECT app_private.current_user_id())
         OR recipient_user_id = (SELECT app_private.current_user_id()))
  WITH CHECK (sender_user_id = (SELECT app_private.current_user_id())
              OR recipient_user_id = (SELECT app_private.current_user_id()));
--> statement-breakpoint

-- Staff module: employment records are management-only; workload and leave
-- are visible to the teacher themselves; timeslots follow class visibility.
CREATE POLICY staff_employment_records_select ON public.staff_employment_records FOR SELECT TO tushciemat_api
  USING (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[]));
CREATE POLICY staff_employment_records_insert ON public.staff_employment_records FOR INSERT TO tushciemat_api
  WITH CHECK (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[])
              AND app_private.has_school_capability(school_id, 'staff.manage'));
CREATE POLICY staff_employment_records_update ON public.staff_employment_records FOR UPDATE TO tushciemat_api
  USING (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[])
         AND app_private.has_school_capability(school_id, 'staff.manage'))
  WITH CHECK (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[])
              AND app_private.has_school_capability(school_id, 'staff.manage'));
CREATE POLICY staff_employment_records_delete ON public.staff_employment_records FOR DELETE TO tushciemat_api
  USING (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[])
         AND app_private.has_school_capability(school_id, 'staff.manage'));
--> statement-breakpoint

CREATE POLICY teacher_workload_select ON public.teacher_workload FOR SELECT TO tushciemat_api
  USING (teacher_auth_id = (SELECT app_private.current_user_id())
         OR app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[]));
CREATE POLICY teacher_workload_insert ON public.teacher_workload FOR INSERT TO tushciemat_api
  WITH CHECK (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[]));
CREATE POLICY teacher_workload_update ON public.teacher_workload FOR UPDATE TO tushciemat_api
  USING (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[]))
  WITH CHECK (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[]));
CREATE POLICY teacher_workload_delete ON public.teacher_workload FOR DELETE TO tushciemat_api
  USING (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[]));
--> statement-breakpoint

CREATE POLICY class_timeslots_select ON public.class_timeslots FOR SELECT TO tushciemat_api
  USING (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[])
         OR app_private.teaches_class(class_id)
         OR app_private.is_class_learner(class_id)
         OR app_private.is_guardian_of_class_learner(class_id));
CREATE POLICY class_timeslots_insert ON public.class_timeslots FOR INSERT TO tushciemat_api
  WITH CHECK (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[]));
CREATE POLICY class_timeslots_update ON public.class_timeslots FOR UPDATE TO tushciemat_api
  USING (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[]))
  WITH CHECK (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[]));
CREATE POLICY class_timeslots_delete ON public.class_timeslots FOR DELETE TO tushciemat_api
  USING (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[]));
--> statement-breakpoint

CREATE POLICY teacher_leave_requests_select ON public.teacher_leave_requests FOR SELECT TO tushciemat_api
  USING (teacher_auth_id = (SELECT app_private.current_user_id())
         OR app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[]));
CREATE POLICY teacher_leave_requests_insert ON public.teacher_leave_requests FOR INSERT TO tushciemat_api
  WITH CHECK (teacher_auth_id = (SELECT app_private.current_user_id())
              AND app_private.has_school_role(school_id, ARRAY['teacher']::public.school_role[]));
CREATE POLICY teacher_leave_requests_update ON public.teacher_leave_requests FOR UPDATE TO tushciemat_api
  USING (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[])
         OR (teacher_auth_id = (SELECT app_private.current_user_id()) AND status = 'pending'))
  WITH CHECK (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[])
              OR (teacher_auth_id = (SELECT app_private.current_user_id()) AND status = 'pending'));
--> statement-breakpoint

CREATE POLICY teacher_leave_balances_select ON public.teacher_leave_balances FOR SELECT TO tushciemat_api
  USING (teacher_auth_id = (SELECT app_private.current_user_id())
         OR app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[]));
CREATE POLICY teacher_leave_balances_insert ON public.teacher_leave_balances FOR INSERT TO tushciemat_api
  WITH CHECK (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[]));
CREATE POLICY teacher_leave_balances_update ON public.teacher_leave_balances FOR UPDATE TO tushciemat_api
  USING (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[]))
  WITH CHECK (app_private.has_school_role(school_id, ARRAY['owner', 'school_admin', 'principal', 'academic_admin']::public.school_role[]));