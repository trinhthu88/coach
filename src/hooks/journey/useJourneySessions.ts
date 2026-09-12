import type { Dispatch, SetStateAction } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { PeerSessionRow, SessionRow, SessionSource } from "./types";
import { withEnrollmentActions, saveEnrollmentActions } from "@/lib/enrollmentActions";
import { useEnrollmentContext } from "@/hooks/useEnrollmentContext";

export type { SessionSource };

interface Options {
  /** Also fetch peer_sessions where the user is the peer coachee. */
  includePeer?: boolean;
  enrollmentId?: string | null;
}

interface JourneySessionsData {
  coachingSessions: SessionRow[];
  peerSessions: PeerSessionRow[];
  coachNames: Record<string, string>;
}

async function fetchJourneySessions(coacheeId: string, includePeer: boolean, enrollmentId: string): Promise<JourneySessionsData> {
  const [{ data: s }, peerResult] = await Promise.all([
    supabase.from("sessions").select("*").eq("coachee_id", coacheeId).eq("enrollment_id", enrollmentId).order("start_time", { ascending: false }),
    includePeer
      ? supabase
          .from("peer_sessions")
          .select("*")
           .eq("peer_coachee_id", coacheeId)
          .eq("enrollment_id", enrollmentId)
          .order("start_time", { ascending: false })
      : Promise.resolve({ data: [] as PeerSessionRow[] }),
  ]);
  const coachingSessions = await withEnrollmentActions(s || [], "coaching");
  const peerSessions = includePeer
    ? await withEnrollmentActions(peerResult.data || [], "peer_coaching")
    : [];

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
  const { includePeer = false, enrollmentId: explicitEnrollmentId } = options;
  const enrollmentContext = useEnrollmentContext(coacheeId, explicitEnrollmentId);
  const enrollmentId = enrollmentContext.selectedEnrollment?.id;
  const queryClient = useQueryClient();
  const queryKey = ["journey-sessions", coacheeId, includePeer, enrollmentId ?? null];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => fetchJourneySessions(coacheeId as string, includePeer, enrollmentId as string),
    enabled: !!coacheeId && !!enrollmentId,
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
      const list = table === "sessions" ? coachingSessions : peerSessions;
      const session = list.find((item) => item.id === sessionId);
      if (!session?.enrollment_id) throw new Error("An enrollment is required to save programme actions");
      const { error } = await saveEnrollmentActions(
        session.enrollment_id,
        table === "sessions" ? "coaching" : "peer_coaching",
        sessionId,
        items as { text: string; done?: boolean; due_date?: string | null; milestone_id?: string | null }[],
      );
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
    const items = [...(sess.enrollment_actions ?? [])];
    const cur = items[idx];
    if (!cur) return;
    const norm = { ...cur, done: !cur.done };
    items[idx] = norm;

    // Optimistic update, reverted via refresh() in onError above (matches
    // pre-migration behavior).
    if (source === "coaching") {
      setCoachingSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, enrollment_actions: items } : s)));
    } else {
      setPeerSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, enrollment_actions: items } : s)));
    }

    await toggleActionMutation.mutateAsync({ table, sessionId, items }).catch(() => {});
  };

  return {
    coachingSessions,
    peerSessions,
    coachNames: data?.coachNames ?? {},
    loading: enrollmentContext.loading || (!!enrollmentId && isLoading),
    refresh,
    toggleAction,
    setCoachingSessions,
    setPeerSessions,
  };
}
