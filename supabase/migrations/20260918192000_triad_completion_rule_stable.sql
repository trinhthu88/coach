-- triad_session_can_complete reads now(), so it cannot be IMMUTABLE: the
-- planner may pre-evaluate an IMMUTABLE call once and keep the result, which
-- would freeze "has the session time started" for the life of a plan. The
-- completion rule itself is unchanged.
ALTER FUNCTION public.triad_session_can_complete(text, timestamptz) STABLE;
