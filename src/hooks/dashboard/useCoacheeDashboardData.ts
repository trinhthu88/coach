import { useEffect, useState } from "react";
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

export function useCoacheeDashboardData(
  userId: string | undefined,
  isCoachee: boolean,
  favorites: string[]
): UseCoacheeDashboardDataResult {
  const [sessions, setSessions] = useState<SessionLite[]>([]);
  const [coachesById, setCoachesById] = useState<Record<string, ProfileLite>>({});
  const [favCoaches, setFavCoaches] = useState<CoachLite[]>([]);
  const [recCoaches, setRecCoaches] = useState<CoachLite[]>([]);
  const [sessionLimit, setSessionLimit] = useState<number>(0);

  useEffect(() => {
    if (!userId || !isCoachee) return;
    (async () => {
      const { data: ses } = await supabase
        .from("sessions")
        .select("id, topic, start_time, duration_minutes, status, meeting_url, coach_id, coachee_id, action_items")
        .eq("coachee_id", userId)
        .order("start_time", { ascending: false });
      const list = ses || [];
      setSessions(list);

      const coachIds = Array.from(new Set(list.map((s) => s.coach_id)));
      if (coachIds.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, full_name, avatar_url")
          .in("id", coachIds);
        const map: Record<string, ProfileLite> = {};
        (profs || []).forEach((p) => (map[p.id] = { full_name: p.full_name, avatar_url: p.avatar_url }));
        setCoachesById(map);
      }

      // Session limit (monthly limit acts as the cap shown in the recap)
      const { data: usage } = await supabase.rpc("get_coachee_session_usage", { _coachee_id: userId });
      if (usage && usage.length > 0) {
        setSessionLimit(usage[0].monthly_limit || 0);
      }

      // Recommended (top-rated active coaches, max 3)
      const { data: recs } = await supabase
        .from("coach_profiles")
        .select("id, title, specialties, rating_avg, years_experience, country_based, profiles!inner(full_name, avatar_url, bio)")
        .eq("approval_status", "active")
        .order("is_featured", { ascending: false })
        .order("rating_avg", { ascending: false })
        .limit(3);
      setRecCoaches((recs as unknown as CoachLite[]) || []);

      // Favorites
      if (favorites.length > 0) {
        const { data: favs } = await supabase
          .from("coach_profiles")
          .select("id, title, specialties, rating_avg, profiles!inner(full_name, avatar_url)")
          .in("id", favorites);
        setFavCoaches((favs as unknown as CoachLite[]) || []);
      } else {
        setFavCoaches([]);
      }
    })();
  }, [userId, isCoachee, favorites]);

  return { sessions, coachesById, favCoaches, recCoaches, sessionLimit };
}
