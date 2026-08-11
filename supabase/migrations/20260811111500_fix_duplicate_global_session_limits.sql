-- Pre-existing bug, unrelated to the sponsor feature, found while testing:
-- session_limits had TWO rows with coachee_id IS NULL (the "global default"
-- row, meant to be singular per its own column comment). A plain UNIQUE
-- constraint does not reject duplicate NULLs in Postgres, so both existed.
--
-- enforce_session_completion_limit() does
--   SELECT monthly_limit FROM session_limits WHERE coachee_id IS NULL
-- as a scalar subquery expecting at most one row. With two rows, this threw
-- "more than one row returned by a subquery used as an expression" —
-- meaning ANY coachee without their own personal session_limits override
-- got a hard error the moment a session of theirs was marked 'completed'.

-- Keep the oldest global-default row, remove any duplicates.
DELETE FROM public.session_limits
WHERE coachee_id IS NULL
  AND id NOT IN (
    SELECT id FROM public.session_limits
    WHERE coachee_id IS NULL
    ORDER BY created_at ASC
    LIMIT 1
  );

-- Guard against this recurring: a unique index on a constant expression,
-- scoped to rows where coachee_id IS NULL, allows at most one such row
-- (the standard Postgres idiom for "unique NULL").
CREATE UNIQUE INDEX ux_session_limits_one_global_default
  ON public.session_limits ((1))
  WHERE coachee_id IS NULL;

-- coach_session_limits has the identical "NULL = global default" design
-- (see its own column comment) and was not yet duplicated, but apply the
-- same guard preventatively rather than wait for the same bug to recur
-- there.
CREATE UNIQUE INDEX ux_coach_session_limits_one_global_default
  ON public.coach_session_limits ((1))
  WHERE coach_user_id IS NULL;
