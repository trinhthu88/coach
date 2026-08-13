import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Database } from "@/integrations/supabase/types";

export type SessionLite = Pick<
  Database["public"]["Tables"]["sessions"]["Row"],
  "id" | "topic" | "start_time" | "duration_minutes" | "status" | "meeting_url" | "coach_id" | "coachee_id" | "action_items"
>;

export type CoachLite = {
  id: string;
  title: string | null;
  specialties: string[] | null;
  rating_avg: number;
  years_experience: number | null;
  country_based: string | null;
  profiles: { full_name: string; avatar_url: string | null; bio: string | null } | null;
};

type ProfileLite = { full_name: string; avatar_url: string | null };

interface UseCoacheeDashboardDataResult {
  sessions: SessionLite[];
  coachesById: Record<string, ProfileLite>;
  favCoaches: CoachLite[];
  recCoaches: CoachLite[];
  sessionLimit: number;
}

const emptyData: UseCoacheeDashboardDataResult = {
  sessions: [],
  coachesById: {},
  favCoaches: [],
  recCoaches: [],
  sessionLimit: 0,
};

async function fetchCoacheeDashboardData(
  userId: string,
  favorites: string[]
): Promise<UseCoacheeDashboardDataResult> {
  const { data: ses } = await supabase
    .from("sessions")
    .select("id, topic, start_time, duration_minutes, status, meeting_url, coach_id, coachee_id, action_items")
    .eq("coachee_id", userId)
    .order("start_time", { ascending: false });
  const list = ses || [];

  const coachIds = Array.from(new Set(list.map((s) => s.coach_id)));
  let coachesById: Record<string, ProfileLite> = {};
  if (coachIds.length) {
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, full_name, avatar_url")
      .in("id", coachIds);
    coachesById = Object.fromEntries(
      (profs || []).map((p) => [p.id, { full_name: p.full_name, avatar_url: p.avatar_url }])
    );
  }

  // Session limit (monthly limit acts as the cap shown in the recap)
  const { data: usage } = await supabase.rpc("get_coachee_session_usage", { _coachee_id: userId });
  const sessionLimit = usage && usage.length > 0 ? usage[0].monthly_limit || 0 : 0;

  // Recommended (top-rated active coaches, max 3)
  const { data: recs } = await supabase
    .from("coach_profiles")
    .select("id, title, specialties, rating_avg, years_experience, country_based, profiles!inner(full_name, avatar_url, bio)")
    .eq("approval_status", "active")
    .order("is_featured", { ascending: false })
    .order("rating_avg", { ascending: false })
    .limit(3);
  const recCoaches = (recs as unknown as CoachLite[]) || [];

  // Favorites
  let favCoaches: CoachLite[] = [];
  if (favorites.length > 0) {
    const { data: favs } = await supabase
      .from("coach_profiles")
      .select("id, title, specialties, rating_avg, profiles!inner(full_name, avatar_url)")
      .in("id", favorites);
    favCoaches = (favs as unknown as CoachLite[]) || [];
  }

  return { sessions: list, coachesById, favCoaches, recCoaches, sessionLimit };
}

export function useCoacheeDashboardData(
  userId: string | undefined,
  isCoachee: boolean,
  favorites: string[]
): UseCoacheeDashboardDataResult {
  const { data } = useQuery({
    queryKey: ["coachee-dashboard", userId, favorites],
    queryFn: () => fetchCoacheeDashboardData(userId as string, favorites),
    enabled: !!userId && isCoachee,
    staleTime: 30_000,
  });

  return data ?? emptyData;
}
