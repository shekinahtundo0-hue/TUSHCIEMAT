-- Academic Results Module
-- Tables for assessments, grading, and result publications

-- Assessment enums
CREATE TYPE public.assessment_submission_status AS ENUM ('pending', 'submitted', 'marked');
CREATE TYPE public.result_publication_status AS ENUM ('draft', 'pending_review', 'approved', 'published', 'rejected');

-- Assessment types
CREATE TABLE public.assessment_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  name text NOT NULL,
  max_marks integer NOT NULL CHECK (max_marks > 0),
  weight numeric(5,2) NOT NULL DEFAULT 100 CHECK (weight > 0 AND weight <= 100),
  created_by_user_id text NOT NULL REFERENCES public.user_profiles(auth_user_id),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX assessment_types_school_idx ON public.assessment_types(school_id);

-- Assessments
CREATE TABLE public.assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  term_id uuid NOT NULL REFERENCES public.terms(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES public.school_classes(id) ON DELETE CASCADE,
  assessment_type_id uuid NOT NULL REFERENCES public.assessment_types(id) ON DELETE RESTRICT,
  subject text NOT NULL,
  max_marks integer NOT NULL CHECK (max_marks > 0),
  created_by_user_id text NOT NULL REFERENCES public.user_profiles(auth_user_id),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(class_id, term_id, subject, assessment_type_id)
);

CREATE INDEX assessments_term_idx ON public.assessments(term_id);
CREATE INDEX assessments_class_idx ON public.assessments(class_id);
CREATE INDEX assessments_type_idx ON public.assessments(assessment_type_id);

-- Student assessment marks
CREATE TABLE public.student_assessment_marks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  assessment_id uuid NOT NULL REFERENCES public.assessments(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  marks_obtained numeric(8,2),
  marked_by_user_id text REFERENCES public.user_profiles(auth_user_id),
  marked_at timestamp with time zone,
  feedback text,
  edit_count integer NOT NULL DEFAULT 0,
  last_edited_by_user_id text REFERENCES public.user_profiles(auth_user_id),
  last_edited_at timestamp with time zone,
  submission_status public.assessment_submission_status NOT NULL DEFAULT 'pending',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(assessment_id, student_id),
  CHECK (marks_obtained IS NULL OR marks_obtained >= 0)
);

CREATE INDEX student_assessment_marks_assessment_idx ON public.student_assessment_marks(assessment_id);
CREATE INDEX student_assessment_marks_student_idx ON public.student_assessment_marks(student_id);

-- Grading scales
CREATE TABLE public.grading_scales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  grade_bands jsonb NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX grading_scales_school_idx ON public.grading_scales(school_id);
CREATE UNIQUE INDEX grading_scales_school_default_unique ON public.grading_scales(school_id) WHERE is_default;

-- Result publications
CREATE TABLE public.result_publications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  term_id uuid NOT NULL REFERENCES public.terms(id) ON DELETE CASCADE,
  class_id uuid REFERENCES public.school_classes(id) ON DELETE CASCADE,
  published_by_user_id text NOT NULL REFERENCES public.user_profiles(auth_user_id),
  published_at timestamp with time zone,
  is_published boolean NOT NULL DEFAULT false,
  status public.result_publication_status NOT NULL DEFAULT 'draft',
  reviewed_by_user_id text REFERENCES public.user_profiles(auth_user_id),
  reviewed_at timestamp with time zone,
  rejection_reason text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CHECK (
    (status = 'published' AND is_published = true AND published_at IS NOT NULL)
    OR (status = 'draft' AND is_published = false AND published_at IS NULL)
    OR status IN ('pending_review', 'approved', 'rejected')
  )
);

CREATE INDEX result_publications_school_term_idx ON public.result_publications(school_id, term_id);
CREATE INDEX result_publications_status_idx ON public.result_publications(status);

-- Student term aggregates (calculated)
CREATE TABLE public.student_term_aggregates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  term_id uuid NOT NULL REFERENCES public.terms(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES public.school_classes(id) ON DELETE CASCADE,
  subject text NOT NULL,
  total_marks numeric(8,2),
  average_percentage numeric(5,2),
  grade text,
  position_in_class integer,
  calculated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(student_id, term_id, subject)
);

CREATE INDEX student_term_aggregates_term_class_idx ON public.student_term_aggregates(term_id, class_id);

--> statement-breakpoint
