-- Quiz, reflection, and prompts each have their own is_visible toggle;
-- the skill card itself only inherited the week's master is_visible.
-- This adds an independent toggle so admin can hide just the skill card
-- while quiz/reflection/prompts (each with their own is_visible = true)
-- stay available for that week.
ALTER TABLE public.training_weeks
  ADD COLUMN IF NOT EXISTS skill_card_visible BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.training_weeks.skill_card_visible IS
  'Independent toggle. When false the skill-card content is hidden even if the week itself (is_visible) is visible. Quiz, reflection, and prompts can still show if they have their own is_visible = true.';
