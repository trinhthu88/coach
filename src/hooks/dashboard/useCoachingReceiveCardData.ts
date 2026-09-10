import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppRole } from "@/context/AuthContext";
import { withEnrollmentActions } from "@/lib/enrollmentActions";
import { useEnrollmentContext } from "@/hooks/useEnrollmentContext";

interface CoachingReceiveData {
  nextSession: {
    id: string;
    topic: string;
    start_time: string;
    coach: { full_name: string; avatar_url: string | null } | null;
  } | null;
  goalProgressPct: number;
  actionItemsOpen: number;
  sessionsUsed: number;
  sessionLimit: number | null; // null = no cap tracked (e.g. coach-as-coachee)
  upcomingCount: number;
}

const empty: CoachingReceiveData = {
  nextSession: null,
  goalProgressPct: 0,
  actionItemsOpen: 0,
  sessionsUsed: 0,
  sessionLimit: null,
  upcomingCount: 0,
};

async function fetchData(userId: string, role: AppRole, enrollmentId: string): Promise<CoachingReceiveData> {
  // Sessions, milestones, and the usage RPC don't depend on one another —
  // fire them together instead of one-at-a-time so the round trips overlap
  // instead of stacking (each hop costs real latency; see 2026-09-08
  // dashboard-load-latency investigation). Only the coach profile lookup
  // genuinely depends on a prior result (next session's coach_id).
  const [{ data: sessions }, { data: milestones }] = await Promise.all([
    supabase
      .from("sessions")
       .select("id, topic, start_time, status, coach_id, enrollment_id")
      .eq("coachee_id", userId)
      .eq("enrollment_id", enrollmentId)
      .order("start_time", { ascending: false }),
    supabase.from("coachee_milestones").select("is_done").eq("coachee_id", userId).eq("enrollment_id", enrollmentId),
  ]);
  const usageResult =
    role === "coachee"
      ? await supabase.rpc("get_coachee_session_usage_for_enrollment", {
          p_enrollment_id: enrollmentId,
        })
      : { data: null };
  const list = await withEnrollmentActions(sessions || [], "coaching");

  const now = new Date();
  const upcoming = list
    .filter((s) => s.status === "confirmed" && new Date(s.start_time) >= now)
    .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
  const next = upcoming[0] ?? null;

  let coach: { full_name: string; avatar_url: string | null } | null = null;
  if (next) {
    const { data: p } = await supabase
      .from("profiles")
      .select("full_name, avatar_url")
      .eq("id", next.coach_id)
      .maybeSingle();
    coach = p ?? null;
  }

  const actionItemsOpen = list.reduce((acc, s) => {
    const arr = s.enrollment_actions ?? [];
    return acc + arr.filter((it) => !it.done).length;
  }, 0);

  const totalMs = milestones?.length ?? 0;
  const doneMs = milestones?.filter((m) => m.is_done).length ?? 0;
  const goalProgressPct = totalMs ? Math.round((doneMs / totalMs) * 100) : 0;

  let sessionsUsed = list.filter((s) => ["pending_coach_approval", "confirmed", "completed"].includes(s.status)).length;
  let sessionLimit: number | null = null;
  const usage = usageResult.data;
  if (role === "coachee" && usage && usage.length > 0) {
    sessionLimit = usage[0].monthly_limit ?? null;
    sessionsUsed = usage[0].used_this_month ?? sessionsUsed;
  }

  return {
    nextSession: next ? { id: next.id, topic: next.topic, start_time: next.start_time, coach } : null,
    goalProgressPct,
    actionItemsOpen,
    sessionsUsed,
    sessionLimit,
    upcomingCount: upcoming.length,
  };
}

export function useCoachingReceiveCardData(userId: string | undefined, role: AppRole | null, enabled: boolean) {
  const enrollmentContext = useEnrollmentContext(userId);
  const enrollmentId = enrollmentContext.selectedEnrollment?.id;
  const { data, isLoading } = useQuery({
    queryKey: ["coaching-receive-card", userId, enrollmentId ?? null],
    queryFn: () => fetchData(userId as string, role as AppRole, enrollmentId as string),
    enabled: !!userId && !!role && !!enrollmentId && enabled,
    staleTime: 30_000,
  });
  return { data: data ?? empty, loading: enrollmentContext.loading || isLoading };
}
