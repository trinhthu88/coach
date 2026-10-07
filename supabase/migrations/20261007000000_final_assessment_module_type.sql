-- ===========================================================================
-- Final Assessment module type (Prompt A5, part 1 of 2)
--
-- A new programme_module_type value. It is NOT the old 'assessment' value
-- (an unused placeholder from 20260903100000), which keeps its meaning.
-- Added in its own migration: Postgres cannot use an enum value in the
-- transaction that adds it, and 20261007000100 uses it everywhere.
-- ===========================================================================
ALTER TYPE public.programme_module_type ADD VALUE IF NOT EXISTS 'final_assessment';
