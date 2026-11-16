-- Digital Classroom Module
-- Tables for learning resources, lessons, and student learning progress

-- Lesson/content organization
CREATE TABLE public.class_lessons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES public.school_classes(id) ON DELETE CASCADE,
  topic text,
  unit text,
  chapter text,
  lesson_name text NOT NULL,
  order_index integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(class_id, topic, unit, chapter, lesson_name)
);

CREATE INDEX class_lessons_class_idx ON public.class_lessons(class_id);

-- Learning resources
CREATE TYPE public.resource_type AS ENUM ('pdf', 'docx', 'pptx', 'image', 'video', 'link', 'other');

CREATE TABLE public.learning_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES public.school_classes(id) ON DELETE CASCADE,
  lesson_id uuid REFERENCES public.class_lessons(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  learning_objectives jsonb NOT NULL DEFAULT '[]',
  resource_type public.resource_type NOT NULL,
  file_path text,
  file_name text,
  file_size_bytes integer,
  uploaded_by_user_id text NOT NULL REFERENCES public.user_profiles(auth_user_id),
  published_at timestamp with time zone,
  scheduled_publish_at timestamp with time zone,
  expires_at timestamp with time zone,
  is_visible_to_students boolean NOT NULL DEFAULT false,
  restricted_to_student_ids jsonb DEFAULT '[]',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  deleted_at timestamp with time zone,
  CHECK (
    CASE
      WHEN published_at IS NOT NULL THEN is_visible_to_students = true
      WHEN scheduled_publish_at IS NOT NULL THEN is_visible_to_students = false
      ELSE true
    END
  )
);

CREATE INDEX learning_resources_class_idx ON public.learning_resources(school_id, class_id);
CREATE INDEX learning_resources_lesson_idx ON public.learning_resources(lesson_id);
CREATE INDEX learning_resources_visible_idx ON public.learning_resources(class_id, published_at)
  WHERE is_visible_to_students AND deleted_at IS NULL;

-- Resource access logs
CREATE TABLE public.resource_access_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  resource_id uuid NOT NULL REFERENCES public.learning_resources(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  accessed_at timestamp with time zone NOT NULL DEFAULT now(),
  was_downloaded boolean NOT NULL DEFAULT false,
  viewed_duration_seconds integer DEFAULT 0
);

CREATE INDEX resource_access_logs_resource_idx ON public.resource_access_logs(resource_id);
CREATE INDEX resource_access_logs_student_idx ON public.resource_access_logs(student_id);
CREATE INDEX resource_access_logs_school_date_idx ON public.resource_access_logs(school_id, accessed_at);

-- Student learning progress
CREATE TABLE public.student_learning_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES public.school_classes(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  lesson_id uuid NOT NULL REFERENCES public.class_lessons(id) ON DELETE CASCADE,
  completed_at timestamp with time zone,
  bookmarked_at timestamp with time zone,
  UNIQUE(student_id, lesson_id)
);

CREATE INDEX student_learning_progress_student_idx ON public.student_learning_progress(student_id);
CREATE INDEX student_learning_progress_lesson_idx ON public.student_learning_progress(lesson_id);

--> statement-breakpoint
