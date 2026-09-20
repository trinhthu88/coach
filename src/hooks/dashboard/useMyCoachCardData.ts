import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface CoachingTeamMember {
  id: string;
  full_name: string;
  avatar_url: string | null;
  title: string | null;
}

/**
 * The learner's Coaching team: every Coach assigned to their cohort.
 *
 * This used to return the single most recent coachee_coach_allowlist row and
 * call it "my coach". That was misleading even before the redesign -- the
 * allowlist could hold several Coaches and picking the newest implied a
 * permanent pairing the data never expressed.
 *
 * A cohort now has a Coach POOL, and a learner may book a different Coach for
 * each Coaching requirement, so there is no single programme Coach to show. If
 * a primary-Coach relationship is wanted later it must be modelled explicitly,
 * never inferred from session history or allowlist ordering.
 */
async function fetchCoachingTeam(enrollmentId: string): Promise<CoachingTeamMember[]> {
  const { data: pool, error } = await supabase.rpc("enrollment_coaching_coach_pool", {
    p_enrollment_id: enrollmentId,
  });
  if (error) throw error;

  const ids = (pool ?? []).map((r) => r.coach_id!).filter(Boolean);
  if (ids.length === 0) return [];

  // Neither profiles nor coach_profiles is embeddable from an RPC result, so
  // resolve the display fields in two follow-up reads.
  const [{ data: profiles }, { data: coachProfiles }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, avatar_url").in("id", ids),
    supabase.from("coach_profiles").select("id, title").in("id", ids),
  ]);

  return ids.map((id) => {
    const p = profiles?.find((x) => x.id === id);
    return {
      id,
      full_name: p?.full_name ?? "Coach",
      avatar_url: p?.avatar_url ?? null,
      title: coachProfiles?.find((x) => x.id === id)?.title ?? null,
    };
  });
}

/**
 * Backs MyCoachCard. Returns the whole cohort Coach pool.
 *
 * `data` stays the first team member so existing single-Coach callers keep
 * working, but `team` is the honest shape and new UI should use it.
 */
export function useMyCoachCardData(enrollmentId: string | undefined, enabled: boolean) {
  const { data, isLoading } = useQuery({
    queryKey: ["my-coach-card", enrollmentId],
    queryFn: () => fetchCoachingTeam(enrollmentId as string),
    enabled: !!enrollmentId && enabled,
    staleTime: 30_000,
  });
  const team = data ?? [];
  return { data: team[0] ?? null, team, loading: isLoading };
}
