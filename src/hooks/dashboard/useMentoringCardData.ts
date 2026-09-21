import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface MentoringGiveData {
  upcoming: { id: string; topic: string; start_time: string; mentee: string | null }[];
  upcomingCount: number;
  menteeCount: number;
  sessionsDelivered: number;
}

const emptyGive: MentoringGiveData = { upcoming: [], upcomingCount: 0, menteeCount: 0, sessionsDelivered: 0 };

/**
 * The MENTOR's own delivery workspace: how many sessions they have run and for
 * how many mentees. This is deliberately person-level and not enrollment
 * scoped -- it is provider analytics about the mentor, not a learner's
 * programme progress, and the two must not be conflated (section 15).
 */
async function fetchGive(userId: string): Promise<MentoringGiveData> {
  const { data } = await supabase
    .from("mentoring_sessions")
    .select("id, topic, start_time, status, mentee_id")
    .eq("mentor_id", userId)
    .order("start_time", { ascending: false });
  const list = data || [];
  const now = new Date();
  const allUpcoming = list
    .filter((s) => s.status === "confirmed" && new Date(s.start_time) >= now)
    .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
  const upcomingRows = allUpcoming.slice(0, 3);

  const menteeIds = Array.from(new Set(upcomingRows.map((s) => s.mentee_id)));
  let namesById: Record<string, string> = {};
  if (menteeIds.length) {
    const { data: profs } = await supabase.from("profiles").select("id, full_name").in("id", menteeIds);
    namesById = Object.fromEntries((profs || []).map((p) => [p.id, p.full_name]));
  }

  return {
    upcoming: upcomingRows.map((s) => ({
      id: s.id,
      topic: s.topic,
      start_time: s.start_time,
      mentee: namesById[s.mentee_id] ?? null,
    })),
    upcomingCount: allUpcoming.length,
    menteeCount: new Set(list.filter((s) => ["confirmed", "completed"].includes(s.status)).map((s) => s.mentee_id))
      .size,
    sessionsDelivered: list.filter((s) => s.status === "completed").length,
  };
}

export function useMentoringGiveCardData(userId: string | undefined, enabled: boolean) {
  const { data, isLoading } = useQuery({
    queryKey: ["mentoring-give-card", userId],
    queryFn: () => fetchGive(userId as string),
    enabled: !!userId && enabled,
    staleTime: 30_000,
  });
  return { data: data ?? emptyGive, loading: isLoading };
}

interface MentoringReceiveData {
  nextSession: {
    id: string;
    topic: string;
    start_time: string;
    mentor: { full_name: string; avatar_url: string | null } | null;
    prepFileUploaded: boolean;
  } | null;
  upcomingCount: number;
  /**
   * Canonical Mentoring programme progress. Never counted from the session
   * rows below: only a session with status 'completed', attributed to THIS
   * enrollment, is a completed Mentoring unit. null = no Mentoring module for
   * this enrollment; a failed canonical read throws (error state, never 0).
   */
  requiredUnits: number | null;
  completedUnits: number | null;
  bookedUnits: number | null;
  overdueUnits: number | null;
}

const emptyReceive: MentoringReceiveData = {
  nextSession: null,
  upcomingCount: 0,
  requiredUnits: null,
  completedUnits: null,
  bookedUnits: null,
  overdueUnits: null,
};

/**
 * The learner's Mentoring card, scoped to the SELECTED enrollment.
 *
 * It previously filtered on mentee_id alone, so a session belonging to a
 * historical enrollment appeared against the current programme -- the exact
 * cross-enrollment leakage the canonical model forbids.
 */
async function fetchReceive(enrollmentId: string): Promise<MentoringReceiveData> {
  const [{ data }, { data: progressRows, error: progressError }] = await Promise.all([
    supabase
      .from("mentoring_sessions")
      .select("id, topic, start_time, status, mentor_id, prep_file_path")
      .eq("enrollment_id", enrollmentId)
      .order("start_time", { ascending: false }),
    supabase.rpc("learner_module_progress", {
      p_enrollment_id: enrollmentId,
      p_as_of: new Date().toISOString().slice(0, 10),
    }),
  ]);
  if (progressError) throw progressError;
  const mentoring = (progressRows ?? []).find((r) => r.module === "mentoring") ?? null;
  const list = data || [];
  const now = new Date();
  const upcomingRows = list
    .filter((s) => ["confirmed", "pending_coach_approval"].includes(s.status) && new Date(s.start_time) >= now)
    .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
  const next = upcomingRows[0];

  const progress = {
    requiredUnits: mentoring ? mentoring.required_units : null,
    completedUnits: mentoring ? mentoring.completed_units : null,
    bookedUnits: mentoring ? mentoring.booked_units : null,
    overdueUnits: mentoring ? mentoring.overdue_units : null,
  };

  if (!next) return { ...emptyReceive, ...progress, upcomingCount: upcomingRows.length };

  const { data: mentor } = await supabase
    .from("profiles")
    .select("full_name, avatar_url")
    .eq("id", next.mentor_id)
    .maybeSingle();

  return {
    nextSession: {
      id: next.id,
      topic: next.topic,
      start_time: next.start_time,
      mentor: mentor ?? null,
      prepFileUploaded: !!next.prep_file_path,
    },
    upcomingCount: upcomingRows.length,
    ...progress,
  };
}

export function useMentoringReceiveCardData(enrollmentId: string | undefined, enabled: boolean) {
  const { data, isLoading } = useQuery({
    queryKey: ["mentoring-receive-card", enrollmentId],
    queryFn: () => fetchReceive(enrollmentId as string),
    enabled: !!enrollmentId && enabled,
    staleTime: 30_000,
  });
  return { data: data ?? emptyReceive, loading: isLoading };
}
