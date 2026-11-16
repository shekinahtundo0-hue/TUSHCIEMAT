-- Staff Management & Workload Allocation Module
-- Tables for employment records, workload, timetables, and leave management

-- Staff enums
CREATE TYPE public.employment_type AS ENUM ('full_time', 'part_time', 'contract', 'casual');
CREATE TYPE public.employment_status AS ENUM ('active', 'on_leave', 'on_sabbatical', 'resigned', 'retired', 'suspended');
CREATE TYPE public.leave_type AS ENUM ('sick', 'annual', 'unpaid', 'sabbatical', 'study', 'maternity', 'paternity', 'bereavement');
CREATE TYPE public.leave_request_status AS ENUM ('pending', 'approved', 'rejected', 'cancelled');
CREATE TYPE public.day_of_week AS ENUM ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday');

-- Staff employment records
CREATE TABLE public.staff_employment_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  user_auth_id text NOT NULL REFERENCES public.user_profiles(auth_user_id),
  staff_number text,
  department text,
  designation text NOT NULL,
  employment_type public.employment_type NOT NULL,
  hire_date date NOT NULL,
  employment_end_date date,
  employment_status public.employment_status NOT NULL DEFAULT 'active',
  qualifications jsonb DEFAULT '[]',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(school_id, user_auth_id),
  UNIQUE(school_id, staff_number),
  CHECK (employment_end_date IS NULL OR employment_end_date >= hire_date)
);

CREATE INDEX staff_employment_records_school_idx ON public.staff_employment_records(school_id);
CREATE INDEX staff_employment_records_status_idx ON public.staff_employment_records(employment_status);

-- Teacher workload
CREATE TABLE public.teacher_workload (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  teacher_auth_id text NOT NULL REFERENCES public.user_profiles(auth_user_id),
  term_id uuid,
  assigned_periods_count integer NOT NULL DEFAULT 0,
  max_allowed_periods integer,
  is_overloaded boolean NOT NULL DEFAULT false,
  workload_percentage numeric(5,2) NOT NULL DEFAULT 0,
  calculated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(school_id, teacher_auth_id, term_id)
);

CREATE INDEX teacher_workload_school_idx ON public.teacher_workload(school_id);
CREATE INDEX teacher_workload_overloaded_idx ON public.teacher_workload(school_id)
  WHERE is_overloaded = true;

-- Class timeslots (timetable)
CREATE TABLE public.class_timeslots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES public.school_classes(id) ON DELETE CASCADE,
  day_of_week public.day_of_week NOT NULL,
  period_number integer NOT NULL,
  subject text NOT NULL,
  teacher_auth_id text REFERENCES public.user_profiles(auth_user_id),
  lesson_starts_at time NOT NULL,
  lesson_ends_at time NOT NULL,
  room text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(class_id, day_of_week, period_number),
  CHECK (lesson_ends_at > lesson_starts_at)
);

CREATE INDEX class_timeslots_teacher_idx ON public.class_timeslots(teacher_auth_id);
CREATE INDEX class_timeslots_class_day_idx ON public.class_timeslots(class_id, day_of_week);

-- Teacher leave requests
CREATE TABLE public.teacher_leave_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  teacher_auth_id text NOT NULL REFERENCES public.user_profiles(auth_user_id),
  leave_type public.leave_type NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  reason text,
  status public.leave_request_status NOT NULL DEFAULT 'pending',
  reviewed_by_auth_id text REFERENCES public.user_profiles(auth_user_id),
  reviewed_at timestamp with time zone,
  rejection_reason text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);

CREATE INDEX teacher_leave_requests_school_idx ON public.teacher_leave_requests(school_id);
CREATE INDEX teacher_leave_requests_teacher_idx ON public.teacher_leave_requests(teacher_auth_id);
CREATE INDEX teacher_leave_requests_status_idx ON public.teacher_leave_requests(status);
CREATE INDEX teacher_leave_requests_dates_idx ON public.teacher_leave_requests(start_date, end_date);

-- Teacher leave balances
CREATE TABLE public.teacher_leave_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  teacher_auth_id text NOT NULL REFERENCES public.user_profiles(auth_user_id),
  academic_year_id uuid,
  leave_type public.leave_type NOT NULL,
  total_entitled numeric(8,2) NOT NULL DEFAULT 0,
  used numeric(8,2) NOT NULL DEFAULT 0,
  balance numeric(8,2) NOT NULL DEFAULT 0,
  calculated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(school_id, teacher_auth_id, academic_year_id, leave_type)
);

CREATE INDEX teacher_leave_balances_school_idx ON public.teacher_leave_balances(school_id);

--> statement-breakpoint
