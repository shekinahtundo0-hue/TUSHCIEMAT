-- Learning-materials library completion: spreadsheet/text/archive file kinds,
-- examination-resource and textbook categories, and an optional term link so a
-- document records the academic period it belongs to (the academic year itself
-- is inherited from the class the material is filed under).

ALTER TYPE public.resource_type ADD VALUE IF NOT EXISTS 'spreadsheet';
ALTER TYPE public.resource_type ADD VALUE IF NOT EXISTS 'text';
ALTER TYPE public.resource_type ADD VALUE IF NOT EXISTS 'archive';
ALTER TYPE public.resource_category ADD VALUE IF NOT EXISTS 'exam_resources';
ALTER TYPE public.resource_category ADD VALUE IF NOT EXISTS 'textbook';
--> statement-breakpoint

ALTER TABLE public.learning_resources
  ADD COLUMN term_id uuid REFERENCES public.terms(id) ON DELETE SET NULL;
--> statement-breakpoint

CREATE INDEX learning_resources_term_idx ON public.learning_resources(term_id);
