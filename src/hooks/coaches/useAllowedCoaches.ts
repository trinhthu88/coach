import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { getFriendlyErrorMessage } from "@/lib/errors";

/**
 * The open, self-service Peer practice pool (`coach_profiles.peer_coaching_opt_in`):
 * any two opted-in coaches may book each other, no admin pairing involved.
 *
 * (The other relationship this file once held, the admin-curated
 * coach_as_coachee_allowlist, is retired: a Coach's own Coach is their
 * cohort's Coach pool -- see CoachFindCoach.)
 */

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
      .select("id, title, specialties, rating_avg, peer_coaching_opt_in, profiles!inner(full_name, avatar_url, status)")
      .eq("approval_status", "active")
      .eq("profiles.status", "active")
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
