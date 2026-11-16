-- Targeted Communications Module
-- Enhancements to announcements and new direct messaging tables

-- Announcement enums
CREATE TYPE public.announcement_targeting_type AS ENUM ('all_school', 'specific_classes', 'specific_streams', 'specific_roles', 'specific_students');
CREATE TYPE public.announcement_status AS ENUM ('draft', 'scheduled', 'published', 'archived');
CREATE TYPE public.delivery_status AS ENUM ('pending', 'delivered', 'failed');

-- Extended announcements table (replaces or extends the basic one)
CREATE TABLE public.announcements_extended (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  author_user_id text NOT NULL REFERENCES public.user_profiles(auth_user_id),
  title text NOT NULL,
  body text NOT NULL,
  targeting_type public.announcement_targeting_type NOT NULL DEFAULT 'all_school',
  targeting_metadata jsonb DEFAULT '{}',
  status public.announcement_status NOT NULL DEFAULT 'draft',
  published_at timestamp with time zone,
  scheduled_publish_at timestamp with time zone,
  expires_at timestamp with time zone,
  is_published boolean NOT NULL DEFAULT false,
  total_recipients_count integer,
  delivered_count integer DEFAULT 0,
  read_count integer DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  archived_at timestamp with time zone,
  CHECK (
    (status = 'published' AND is_published = true AND published_at IS NOT NULL)
    OR (status = 'scheduled' AND is_published = false AND scheduled_publish_at IS NOT NULL)
    OR (status = 'draft' AND is_published = false AND published_at IS NULL)
    OR (status = 'archived' AND archived_at IS NOT NULL)
  )
);

CREATE INDEX announcements_extended_school_idx ON public.announcements_extended(school_id);
CREATE INDEX announcements_extended_published_idx ON public.announcements_extended(school_id, published_at DESC)
  WHERE is_published = true;
CREATE INDEX announcements_extended_scheduled_idx ON public.announcements_extended(school_id, scheduled_publish_at)
  WHERE status = 'scheduled';

-- Announcement attachments
CREATE TABLE public.announcement_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_id uuid NOT NULL REFERENCES public.announcements_extended(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  file_type text NOT NULL,
  file_size_bytes integer NOT NULL CHECK (file_size_bytes > 0),
  file_path text NOT NULL,
  uploaded_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX announcement_attachments_announcement_idx ON public.announcement_attachments(announcement_id);

-- Announcement deliveries (tracking)
CREATE TABLE public.announcement_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_id uuid NOT NULL REFERENCES public.announcements_extended(id) ON DELETE CASCADE,
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  recipient_user_id text NOT NULL REFERENCES public.user_profiles(auth_user_id),
  delivery_status public.delivery_status NOT NULL DEFAULT 'pending',
  read_at timestamp with time zone,
  failure_reason text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(announcement_id, recipient_user_id)
);

CREATE INDEX announcement_deliveries_recipient_idx ON public.announcement_deliveries(recipient_user_id, created_at DESC)
  WHERE delivery_status != 'failed';
CREATE INDEX announcement_deliveries_announcement_idx ON public.announcement_deliveries(announcement_id);

-- Direct messages
CREATE TABLE public.direct_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  sender_user_id text NOT NULL REFERENCES public.user_profiles(auth_user_id),
  recipient_user_id text REFERENCES public.user_profiles(auth_user_id),
  recipient_class_id uuid REFERENCES public.school_classes(id) ON DELETE CASCADE,
  message_body text NOT NULL,
  attachment_ids jsonb DEFAULT '[]',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  deleted_at timestamp with time zone,
  CHECK (
    (recipient_user_id IS NOT NULL AND recipient_class_id IS NULL)
    OR (recipient_user_id IS NULL AND recipient_class_id IS NOT NULL)
  )
);

CREATE INDEX direct_messages_sender_idx ON public.direct_messages(sender_user_id);
CREATE INDEX direct_messages_recipient_idx ON public.direct_messages(recipient_user_id)
  WHERE recipient_user_id IS NOT NULL;
CREATE INDEX direct_messages_class_idx ON public.direct_messages(recipient_class_id)
  WHERE recipient_class_id IS NOT NULL;

--> statement-breakpoint
