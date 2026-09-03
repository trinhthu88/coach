import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { getFriendlyErrorMessage } from "@/lib/errors";

/**
 * Two distinct booking-eligibility relationships (RULES.md §3) that both
 * happen to resolve "which coaches can this coach book" — kept as two
 * exported hooks in one file rather than unified into a single query, since
 * unifying them would misrepresent the underlying business rules:
 *
 * - Relationship 2 (`useCoachAsCoacheeAllowlist`): an admin-curated pairing
 *   (`coach_as_coachee_allowlist`) — a coach may only book a mentor-coach
 *   explicitly listed for them.
 * - Relationship 3 (`useOptedInPeerCoaches`): an open, self-service pool
 *   (`coach_profiles.peer_coaching_opt_in`) — any two opted-in coaches may
 *   book each other, no admin pairing involved.
 *
 * Both were previously duplicated inline in CoachFindCoach.tsx and
 * CoachPeerCoaching.tsx; extracted here so a future RLS/filter change only
 * needs to happen in one place per relationship.
 */

interface AllowedCoachRow {
  id: string;
  title: string | null;
  specialties: string[] | null;
  rating_avg: number;
  profiles: { full_name: string; avatar_url: string | null } | null;
}

export function useCoachAsCoacheeAllowlist() {
  const { user } = useAuth();
  const { t } = useTranslation("coaches");
  const [coaches, setCoaches] = useState<AllowedCoachRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    const { data: allowlist, error: allowlistError } = await supabase
      .from("coach_as_coachee_allowlist")
      .select("selectable_coach_id")
      .eq("coach_user_id", user.id);
    if (allowlistError) {
      setError(getFriendlyErrorMessage(allowlistError, t));
      setLoading(false);
      return;
    }
    const ids = (allowlist || []).map((r: { selectable_coach_id: string }) => r.selectable_coach_id);
    if (ids.length) {
      const { data, error: coachesError } = await supabase
        .from("coach_profiles")
        .select("id, title, specialties, rating_avg, profiles!inner(full_name, avatar_url)")
        .in("id", ids)
        .eq("approval_status", "active");
      if (coachesError) {
        setError(getFriendlyErrorMessage(coachesError, t));
        setLoading(false);
        return;
      }
      setCoaches((data as unknown as AllowedCoachRow[]) || []);
    } else {
      setCoaches([]);
    }
    setLoading(false);
  }, [user, t]);

  useEffect(() => {
    load();
  }, [load]);

  return { coaches, loading, error, reload: load };
}

interface OptedInPeerCoach {
  id: string;
  title: string | null;
  specialties: string[] | null;
  rating_avg: number;
  full_name: string;
  avatar_url: string | null;
}

export function useOptedInPeerCoaches() {
  const { user } = useAuth();
  const { t } = useTranslation("profile");
  const [coaches, setCoaches] = useState<OptedInPeerCoach[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    const { data, error: fetchError } = await supabase
      .from("coach_profiles")
      .select("id, title, specialties, rating_avg, peer_coaching_opt_in, profiles!inner(full_name, avatar_url)")
      .eq("approval_status", "active")
      .eq("peer_coaching_opt_in", true)
      .neq("id", user.id);
    if (fetchError) {
      setError(getFriendlyErrorMessage(fetchError, t));
      setLoading(false);
      return;
    }
    setCoaches(
      (data || []).map((c) => ({
        id: c.id,
        title: c.title,
        specialties: c.specialties,
        rating_avg: c.rating_avg,
        full_name: c.profiles?.full_name,
        avatar_url: c.profiles?.avatar_url,
      }))
    );
    setLoading(false);
  }, [user, t]);

  useEffect(() => {
    load();
  }, [load]);

  return { coaches, loading, error, reload: load };
}
