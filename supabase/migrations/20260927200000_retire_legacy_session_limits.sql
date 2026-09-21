-- P2-10: retire legacy session-limit surfaces that are no longer authoritative.
--
-- 1. enforce_session_completion_limit() (trigger trg_sessions_enforce_limit on
--    sessions) flipped a learner's PROFILE to 'reach_limit' once their LIFETIME
--    completed coaching sessions -- across every enrollment -- reached a
--    per-person session_limits cap (default 4). No booking path reads that
--    status for learners (can_book_session budgets by the enrollment's
--    programme requirement), so it only mislabelled learners: a learner at 6/6
--    of a six-session programme, or one starting a second enrollment, showed
--    "Reach limit" in Admin. A derived write with no authority -> dropped, and
--    the learners it labelled are reset. (The coach-as-coachee cap,
--    enforce_coach_as_coachee_limit, is a separate legacy path kept on purpose
--    and is untouched: coach profiles keep their status.)
--
-- 2. session_limits (per-person caps) is read by nothing once (1) is gone. It
--    is moved -- not dropped -- to a locked legacy_archive schema.
--
-- 3. programmes.coach_session_limit / peer_session_limit / peer_given_limit are
--    read by no function, view or policy (the coach limits live in
--    coach_programmes; peer limits in programme_modules.config) -> dropped.
--    programmes.coachee_session_limit is NOT dropped: can_book_session still
--    reads it for Coaching outside programme requirements.
--
-- 4. bulk_invite_rows.session_limit (the import's per-person cap column) is
--    dropped with the import field.

DROP TRIGGER IF EXISTS trg_sessions_enforce_limit ON public.sessions;
DROP FUNCTION IF EXISTS public.enforce_session_completion_limit();

UPDATE public.profiles p
   SET status = 'active'::public.user_status
 WHERE p.status = 'reach_limit'::public.user_status
   AND NOT public.has_role(p.id, 'coach'::public.app_role);

DO $archive_session_limits$
BEGIN
  IF to_regclass('public.session_limits') IS NOT NULL THEN
    CREATE SCHEMA IF NOT EXISTS legacy_archive;
    REVOKE ALL ON SCHEMA legacy_archive FROM PUBLIC, anon, authenticated;
    ALTER TABLE public.session_limits SET SCHEMA legacy_archive;
    REVOKE ALL ON legacy_archive.session_limits FROM PUBLIC, anon, authenticated;
  END IF;
END
$archive_session_limits$;

ALTER TABLE public.programmes
  DROP COLUMN IF EXISTS coach_session_limit,
  DROP COLUMN IF EXISTS peer_session_limit,
  DROP COLUMN IF EXISTS peer_given_limit;

ALTER TABLE public.bulk_invite_rows DROP COLUMN IF EXISTS session_limit;

COMMENT ON COLUMN public.programmes.coachee_session_limit IS
  'Coaching sessions a learner may book OUTSIDE programme requirements (read by can_book_session only when the '
  'programme requires no Coaching units). Programme quantity itself is programme_modules.config.required_units.';
