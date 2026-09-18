-- Triad co-member identity for learners (read-only, scoped projection).
--
-- Problem: a learner could resolve another learner's display name only via
-- the general "Profiles: view active" discovery policy (status = 'active').
-- Triad co-members whose profile status is anything else (e.g. reach_limit)
-- were invisible, so the Triad group card showed only "You". Visibility
-- depended on account status, not on the Triad relationship.
--
-- Fix: a narrow projection instead of another profiles RLS policy.
--   * Membership source of truth: triad_groups.member_1_id / member_2_id /
--     member_3_id (the admin-assigned group). Never derived from sessions,
--     cohort lists or cached names.
--   * Identity source of truth: profiles.
--   * Exposed fields: member id, slot, full_name, avatar_url only — no
--     email, phone, status, metadata, enrollment, goals, notes or sponsor
--     data.
--   * learner_triad_members returns rows only for groups the caller is a
--     member of; any other group (same cohort or not) returns nothing.
-- profiles RLS is unchanged.

CREATE OR REPLACE FUNCTION public.canonical_triad_group_members(
  p_group_ids uuid[]
)
RETURNS TABLE (
  triad_group_id uuid,
  member_id uuid,
  member_slot integer,
  full_name text,
  avatar_url text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT g.id, m.member_id, m.member_slot, pr.full_name, pr.avatar_url
  FROM public.triad_groups g
  CROSS JOIN LATERAL (
    VALUES (g.member_1_id, 1), (g.member_2_id, 2), (g.member_3_id, 3)
  ) AS m(member_id, member_slot)
  JOIN public.profiles pr ON pr.id = m.member_id
  WHERE g.id = ANY (p_group_ids)
    AND m.member_id IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.canonical_triad_group_members(uuid[])
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.learner_triad_members(
  p_group_ids uuid[]
)
RETURNS TABLE (
  triad_group_id uuid,
  member_id uuid,
  member_slot integer,
  full_name text,
  avatar_url text,
  is_self boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT c.triad_group_id, c.member_id, c.member_slot, c.full_name, c.avatar_url,
    c.member_id = auth.uid()
  FROM public.canonical_triad_group_members(p_group_ids) c
  WHERE auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.triad_groups g
      WHERE g.id = c.triad_group_id
        AND auth.uid() IN (g.member_1_id, g.member_2_id, g.member_3_id)
    )
  ORDER BY c.triad_group_id, c.member_slot;
$$;

REVOKE ALL ON FUNCTION public.learner_triad_members(uuid[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.learner_triad_members(uuid[])
  TO authenticated;
