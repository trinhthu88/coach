import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { PeerSessionRow, SessionRow } from "./types";

export type SessionSource = "coaching" | "peer";

interface Options {
  /** Also fetch peer_sessions where the user is the peer coachee. */
  includePeer?: boolean;
}

/**
 * Owns coaching sessions (and optionally peer sessions) for a coachee,
 * plus the coach/peer-coach display names referenced by those sessions.
 * Shared between the coachee and coach "my journey" views.
 */
export function useJourneySessions(coacheeId: string | undefined, options: Options = {}) {
  const { includePeer = false } = options;
  const [coachingSessions, setCoachingSessions] = useState<SessionRow[]>([]);
  const [peerSessions, setPeerSessions] = useState<PeerSessionRow[]>([]);
  const [coachNames, setCoachNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!coacheeId) return;
    setLoading(true);
    const [{ data: s }, peerResult] = await Promise.all([
      supabase.from("sessions").select("*").eq("coachee_id", coacheeId).order("start_time", { ascending: false }),
      includePeer
        ? supabase
            .from("peer_sessions")
            .select("*")
            .eq("peer_coachee_id", coacheeId)
            .order("start_time", { ascending: false })
        : Promise.resolve({ data: [] as PeerSessionRow[] }),
    ]);
    setCoachingSessions(s || []);
    setPeerSessions(peerResult.data || []);

    const ids = new Set<string>();
    (s || []).forEach((x) => x.coach_id && ids.add(x.coach_id));
    (peerResult.data || []).forEach((x) => x.peer_coach_id && ids.add(x.peer_coach_id));
    if (ids.size) {
      const { data: profs } = await supabase.from("profiles").select("id, full_name").in("id", Array.from(ids));
      const map: Record<string, string> = {};
      for (const p of profs || []) map[p.id] = p.full_name;
      setCoachNames(map);
    } else {
      setCoachNames({});
    }
    setLoading(false);
  }, [coacheeId, includePeer]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const toggleAction = useCallback(
    async (sessionId: string, idx: number, source: SessionSource = "coaching") => {
      const table = source === "coaching" ? "sessions" : "peer_sessions";
      const list = source === "coaching" ? coachingSessions : peerSessions;
      const sess = list.find((s) => s.id === sessionId);
      if (!sess) return;
      const items = Array.isArray(sess.action_items) ? [...(sess.action_items as unknown[])] : [];
      const cur = items[idx];
      const norm = typeof cur === "string" ? { text: cur, done: false } : { ...(cur as object) };
      (norm as { done?: boolean }).done = !(norm as { done?: boolean }).done;
      items[idx] = norm;

      if (source === "coaching") {
        setCoachingSessions((prev) =>
          prev.map((s) => (s.id === sessionId ? { ...s, action_items: items as SessionRow["action_items"] } : s))
        );
      } else {
        setPeerSessions((prev) =>
          prev.map((s) => (s.id === sessionId ? { ...s, action_items: items as PeerSessionRow["action_items"] } : s))
        );
      }

      const { error } = await supabase
        .from(table)
        .update({ action_items: items as never })
        .eq("id", sessionId);
      if (error) {
        toast.error(error.message);
        refresh();
      }
    },
    [coachingSessions, peerSessions, refresh]
  );

  return {
    coachingSessions,
    peerSessions,
    coachNames,
    loading,
    refresh,
    toggleAction,
    setCoachingSessions,
    setPeerSessions,
  };
}
