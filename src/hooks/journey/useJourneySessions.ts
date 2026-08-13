import type { Dispatch, SetStateAction } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { PeerSessionRow, SessionRow, SessionSource } from "./types";

export type { SessionSource };

interface Options {
  /** Also fetch peer_sessions where the user is the peer coachee. */
  includePeer?: boolean;
}

interface JourneySessionsData {
  coachingSessions: SessionRow[];
  peerSessions: PeerSessionRow[];
  coachNames: Record<string, string>;
}

async function fetchJourneySessions(coacheeId: string, includePeer: boolean): Promise<JourneySessionsData> {
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
  const coachingSessions = s || [];
  const peerSessions = peerResult.data || [];

  const ids = new Set<string>();
  coachingSessions.forEach((x) => x.coach_id && ids.add(x.coach_id));
  peerSessions.forEach((x) => x.peer_coach_id && ids.add(x.peer_coach_id));
  let coachNames: Record<string, string> = {};
  if (ids.size) {
    const { data: profs } = await supabase.from("profiles").select("id, full_name").in("id", Array.from(ids));
    coachNames = Object.fromEntries((profs || []).map((p) => [p.id, p.full_name]));
  }

  return { coachingSessions, peerSessions, coachNames };
}

/**
 * Owns coaching sessions (and optionally peer sessions) for a coachee,
 * plus the coach/peer-coach display names referenced by those sessions.
 * Shared between the coachee and coach "my journey" views.
 */
export function useJourneySessions(coacheeId: string | undefined, options: Options = {}) {
  const { includePeer = false } = options;
  const queryClient = useQueryClient();
  const queryKey = ["journey-sessions", coacheeId, includePeer];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => fetchJourneySessions(coacheeId as string, includePeer),
    enabled: !!coacheeId,
    staleTime: 30_000,
  });
  const coachingSessions = data?.coachingSessions ?? [];
  const peerSessions = data?.peerSessions ?? [];

  const refresh = () => queryClient.invalidateQueries({ queryKey });

  const setCoachingSessions: Dispatch<SetStateAction<SessionRow[]>> = (value) => {
    queryClient.setQueryData(queryKey, (prev: JourneySessionsData | undefined) => {
      if (!prev) return prev;
      const next = typeof value === "function" ? (value as (p: SessionRow[]) => SessionRow[])(prev.coachingSessions) : value;
      return { ...prev, coachingSessions: next };
    });
  };
  const setPeerSessions: Dispatch<SetStateAction<PeerSessionRow[]>> = (value) => {
    queryClient.setQueryData(queryKey, (prev: JourneySessionsData | undefined) => {
      if (!prev) return prev;
      const next = typeof value === "function" ? (value as (p: PeerSessionRow[]) => PeerSessionRow[])(prev.peerSessions) : value;
      return { ...prev, peerSessions: next };
    });
  };

  const toggleActionMutation = useMutation({
    mutationFn: async ({ table, sessionId, items }: { table: "sessions" | "peer_sessions"; sessionId: string; items: unknown[] }) => {
      const { error } = await supabase
        .from(table)
        .update({ action_items: items as never })
        .eq("id", sessionId);
      if (error) throw error;
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed");
      refresh();
    },
  });

  const toggleAction = async (sessionId: string, idx: number, source: SessionSource = "coaching") => {
    const table = source === "coaching" ? "sessions" : "peer_sessions";
    const list = source === "coaching" ? coachingSessions : peerSessions;
    const sess = list.find((s) => s.id === sessionId);
    if (!sess) return;
    const items = Array.isArray(sess.action_items) ? [...(sess.action_items as unknown[])] : [];
    const cur = items[idx];
    const norm = typeof cur === "string" ? { text: cur, done: false } : { ...(cur as object) };
    (norm as { done?: boolean }).done = !(norm as { done?: boolean }).done;
    items[idx] = norm;

    // Optimistic update, reverted via refresh() in onError above (matches
    // pre-migration behavior).
    if (source === "coaching") {
      setCoachingSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, action_items: items as SessionRow["action_items"] } : s)));
    } else {
      setPeerSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, action_items: items as PeerSessionRow["action_items"] } : s)));
    }

    await toggleActionMutation.mutateAsync({ table, sessionId, items }).catch(() => {});
  };

  return {
    coachingSessions,
    peerSessions,
    coachNames: data?.coachNames ?? {},
    loading: isLoading,
    refresh,
    toggleAction,
    setCoachingSessions,
    setPeerSessions,
  };
}
