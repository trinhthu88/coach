-- has_module_access() is the single source of truth for "can this user use
-- module X" — used both inside RLS policies (e.g. mentoring's
-- can_book_mentoring_session()) and as a frontend-callable RPC for UI gating
-- (route guard + nav visibility), mirroring how can_book_session() /
-- check_can_book_session() are used per RULES.md §5.
--
-- No self-or-admin guard is needed here (unlike can_book_session()): this
-- only ever answers a boolean "is module X enabled for user Y" and is
-- consulted from RLS policies that need to check a *different* user's access
-- (e.g. checking the mentor's, not just the caller's) — so it's callable for
-- any p_user_id. check_has_module_access() below is the pinned wrapper for
-- frontend use, matching check_can_book_session()'s pattern.

CREATE OR REPLACE FUNCTION public.has_module_access(p_user_id uuid, p_module text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT enabled FROM public.user_module_access WHERE user_id = p_user_id AND module = p_module),
    false
  );
$$;

REVOKE EXECUTE ON FUNCTION public.has_module_access(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_module_access(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.check_has_module_access(p_module text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_module_access(auth.uid(), p_module);
$$;

REVOKE EXECUTE ON FUNCTION public.check_has_module_access(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_has_module_access(text) TO authenticated;
