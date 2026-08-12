import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Database } from "@/integrations/supabase/types";

export type CoachSession = Pick<
  Database["public"]["Tables"]["sessions"]["Row"],
  "id" | "topic" | "start_time" | "duration_minutes" | "status" | "coach_notes" | "meeting_url" | "coachee_id"
>;

export type PeerSession = Pick<
  Database["public"]["Tables"]["peer_sessions"]["Row"],
  "id" | "topic" | "start_time" | "duration_minutes" | "status" | "peer_coach_id" | "peer_coachee_id"
>;

type ProfileLite = { full_name: string; avatar_url: string | null; email: string };

interface UseCoachDashboardDataResult {
  sessions: CoachSession[];
  peerSessions: PeerSession[];
  profilesById: Record<string, ProfileLite>;
  loading: boolean;
  actingId: string | null;
  peerOptIn: boolean;
  coachProfile: { rating_avg: number; sessions_completed: number } | null;
  approve: (s: CoachSession) => Promise<void>;
  decline: (s: CoachSession) => Promise<void>;
}

export function useCoachDashboardData(userId: string): UseCoachDashboardDataResult {
  const [sessions, setSessions] = useState<CoachSession[]>([]);
  const [peerSessions, setPeerSessions] = useState<PeerSession[]>([]);
  const [profilesById, setProfilesById] = useState<Record<string, ProfileLite>>({});
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);
  const [peerOptIn, setPeerOptIn] = useState(false);
  const [coachProfile, setCoachProfile] = useState<{
    rating_avg: number;
    sessions_completed: number;
  } | null>(null);

  const reload = useCallback(async () => {
    const [{ data: sess }, { data: peer }, { data: cp }] = await Promise.all([
      supabase
        .from("sessions")
        .select(
          "id, topic, start_time, duration_minutes, status, coach_notes, meeting_url, coachee_id"
        )
        .eq("coach_id", userId)
        .order("start_time", { ascending: false }),
      supabase
        .from("peer_sessions")
        .select(
          "id, topic, start_time, duration_minutes, status, peer_coach_id, peer_coachee_id"
        )
        .or(`peer_coach_id.eq.${userId},peer_coachee_id.eq.${userId}`)
        .order("start_time", { ascending: false }),
      supabase
        .from("coach_profiles")
        .select("rating_avg, sessions_completed, peer_coaching_opt_in")
        .eq("id", userId)
        .maybeSingle(),
    ]);

    const list = sess || [];
    const peerList = peer || [];
    setSessions(list);
    setPeerSessions(peerList);
    if (cp) {
      setCoachProfile({ rating_avg: cp.rating_avg, sessions_completed: cp.sessions_completed });
      setPeerOptIn(!!cp.peer_coaching_opt_in);
    }

    const ids = Array.from(
      new Set([
        ...list.map((s) => s.coachee_id),
        ...peerList.map((s) => s.peer_coach_id),
        ...peerList.map((s) => s.peer_coachee_id),
      ])
    );
    if (ids.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, full_name, avatar_url, email")
        .in("id", ids);
      const map: Record<string, ProfileLite> = {};
      (profs || []).forEach((p) => (map[p.id] = { full_name: p.full_name, avatar_url: p.avatar_url, email: p.email }));
      setProfilesById(map);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const approve = async (s: CoachSession) => {
    setActingId(s.id);
    const { error } = await supabase.functions.invoke("confirm-session", {
      body: { session_id: s.id, is_peer: false },
    });
    setActingId(null);
    if (error) { toast.error(error.message); return; }
    toast.success("Session confirmed. Zoom meeting is ready.");
    reload();
  };
  const decline = async (s: CoachSession) => {
    setActingId(s.id);
    const { error } = await supabase.functions.invoke("cancel-session", {
      body: { session_id: s.id, is_peer: false },
    });
    setActingId(null);
    if (error) { toast.error(error.message); return; }
    toast.success("Request declined");
    reload();
  };

  return { sessions, peerSessions, profilesById, loading, actingId, peerOptIn, coachProfile, approve, decline };
}
