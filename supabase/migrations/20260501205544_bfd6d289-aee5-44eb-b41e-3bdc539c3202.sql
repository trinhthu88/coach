CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE public.coachee_goal_ratings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  goal_id UUID NOT NULL UNIQUE,
  coachee_id UUID NOT NULL,
  start_rating SMALLINT NOT NULL DEFAULT 30 CHECK (start_rating >= 0 AND start_rating <= 100),
  current_rating SMALLINT NOT NULL DEFAULT 30 CHECK (current_rating >= 0 AND current_rating <= 100),
  target_rating SMALLINT NOT NULL DEFAULT 80 CHECK (target_rating >= 0 AND target_rating <= 100),
  current_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.coachee_goal_ratings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "GoalRatings: coachee manage own"
  ON public.coachee_goal_ratings
  FOR ALL
  TO authenticated
  USING (coachee_id = auth.uid())
  WITH CHECK (coachee_id = auth.uid());

CREATE POLICY "GoalRatings: admin all"
  ON public.coachee_goal_ratings
  FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "GoalRatings: coach view client"
  ON public.coachee_goal_ratings
  FOR SELECT
  TO authenticated
  USING (coach_has_client(auth.uid(), coachee_id));

CREATE INDEX idx_coachee_goal_ratings_coachee ON public.coachee_goal_ratings(coachee_id);

CREATE TRIGGER trg_coachee_goal_ratings_updated_at
  BEFORE UPDATE ON public.coachee_goal_ratings
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_set_updated_at();