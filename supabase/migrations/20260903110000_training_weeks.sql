-- Phase 1 (training material delivery), part 1: the weekly skill-card
-- content backbone for the 'training' programme_module (Phase 0). One row
-- per (programme, week_number); skill_card_elements (next migration) hang
-- off each week for the interactive callouts inside the card.

CREATE TABLE public.training_weeks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  programme_id UUID NOT NULL REFERENCES public.programmes(id) ON DELETE CASCADE,
  week_number INT NOT NULL,
  title TEXT NOT NULL,
  title_vi TEXT,
  subtitle TEXT,
  subtitle_vi TEXT,
  skill_card_html TEXT,             -- Rich HTML content for the skill card
  skill_card_html_vi TEXT,          -- Vietnamese version
  pdf_storage_path TEXT,            -- Supabase Storage path for PDF
  pdf_storage_path_vi TEXT,
  is_visible BOOLEAN NOT NULL DEFAULT false,
  unlock_date DATE,                 -- Absolute date; can also be computed from cohort start_date + (week_number - 1) * 7
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (programme_id, week_number)
);

ALTER TABLE public.training_weeks ENABLE ROW LEVEL SECURITY;

-- Admin manages all
CREATE POLICY "Training weeks: admin manage" ON public.training_weeks
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Enrolled users see visible + unlocked weeks only
CREATE POLICY "Training weeks: enrolled users view" ON public.training_weeks
  FOR SELECT TO authenticated
  USING (
    is_visible = true
    AND (unlock_date IS NULL OR unlock_date <= CURRENT_DATE)
    AND EXISTS (
      SELECT 1 FROM public.programme_enrollments pe
      WHERE pe.programme_id = training_weeks.programme_id
        AND pe.user_id = auth.uid()
        AND pe.status = 'active'
    )
    AND public.has_programme_module('training'::programme_module_type)
  );

CREATE TRIGGER trg_training_weeks_updated BEFORE UPDATE ON public.training_weeks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_training_weeks_programme ON public.training_weeks(programme_id, week_number);
