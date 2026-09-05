-- Spec: each skill card has HTML + embedded video + PDF. Adds the missing
-- video embed URL column to training_weeks.
ALTER TABLE public.training_weeks
  ADD COLUMN IF NOT EXISTS video_url TEXT;

COMMENT ON COLUMN public.training_weeks.video_url IS
  'YouTube or Vimeo embed URL rendered as an iframe inside the skill card.';
