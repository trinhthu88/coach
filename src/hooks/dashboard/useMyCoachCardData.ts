import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface MyCoach {
  id: string;
  full_name: string;
  avatar_url: string | null;
  title: string | null;
}

async function fetchMyCoach(userId: string): Promise<MyCoach | null> {
  // coachee_coach_allowlist has no FK declared to profiles (plain uuid
  // columns — see 20260430100320_*.sql), so this can't be a single embedded
  // select; resolve the coach id, then the profile, as two queries.
  const { data: entry } = await supabase
    .from("coachee_coach_allowlist")
    .select("coach_id")
    .eq("coachee_id", userId)
    .is("removed_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!entry) return null;

  const [{ data: profile }, { data: coachProfile }] = await Promise.all([
    supabase.from("profiles").select("full_name, avatar_url").eq("id", entry.coach_id).maybeSingle(),
    supabase.from("coach_profiles").select("title").eq("id", entry.coach_id).maybeSingle(),
  ]);
  if (!profile) return null;

  return {
    id: entry.coach_id,
    full_name: profile.full_name,
    avatar_url: profile.avatar_url,
    title: coachProfile?.title ?? null,
  };
}

/** Backs MyCoachCard — the coachee's single allowlisted coach, if any. */
export function useMyCoachCardData(userId: string | undefined, enabled: boolean) {
  const { data, isLoading } = useQuery({
    queryKey: ["my-coach-card", userId],
    queryFn: () => fetchMyCoach(userId as string),
    enabled: !!userId && enabled,
    staleTime: 30_000,
  });
  return { data: data ?? null, loading: isLoading };
}
