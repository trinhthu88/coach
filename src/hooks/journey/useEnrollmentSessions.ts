import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { DevelopmentSessionItem } from "./developmentSessionTypes";

/**
 * All programme-development sessions for one enrollment, normalized across
 * the four canonical session sources: sessions (coaching), peer_sessions
 * (peer coaching), mentoring_sessions, and triad_sessions. Every row is
 * scoped by its own enrollment_id column — triads by the triad-specific
 * coach/coachee/observer enrollment columns, never by participant user_id
 * alone, so a session never leaks in based on identity rather than
 * enrollment membership. Status and start time are read verbatim from the
 * source row; this hook formats, it does not redefine completion.
 */
async function fetchEnrollmentSessions(enrollmentId: string, userId: string): Promise<DevelopmentSessionItem[]> {
  const [coachingRes, peerRes, mentoringRes, triadRes] = await Promise.all([
    supabase.from("sessions").select("id, topic, status, start_time, coach_id").eq("enrollment_id", enrollmentId),
    supabase.from("peer_sessions").select("id, topic, status, start_time, peer_coach_id, peer_coachee_id").eq("enrollment_id", enrollmentId),
    supabase.from("mentoring_sessions").select("id, topic, status, start_time, mentor_id, mentee_id").eq("enrollment_id", enrollmentId),
    supabase
      .from("triad_sessions")
      .select(
        "id, status, start_time, proposed_start_time, triad_groups(round_number, triad_rounds(title, training_weeks(week_number)))"
      )
      .or(`coach_enrollment_id.eq.${enrollmentId},coachee_enrollment_id.eq.${enrollmentId},observer_enrollment_id.eq.${enrollmentId}`),
  ]);

  const counterpartIds = new Set<string>();
  for (const s of coachingRes.data ?? []) if (s.coach_id) counterpartIds.add(s.coach_id);
  for (const p of peerRes.data ?? []) {
    const other = p.peer_coach_id === userId ? p.peer_coachee_id : p.peer_coach_id;
    if (other) counterpartIds.add(other);
  }
  for (const m of mentoringRes.data ?? []) if (m.mentor_id) counterpartIds.add(m.mentor_id);

  let namesById: Record<string, string> = {};
  if (counterpartIds.size > 0) {
    const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", Array.from(counterpartIds));
    namesById = Object.fromEntries((profiles ?? []).map((p) => [p.id as string, p.full_name as string]));
  }

  const items: DevelopmentSessionItem[] = [];

  for (const s of coachingRes.data ?? []) {
    items.push({
      id: `coaching-${s.id}`,
      enrollmentId,
      type: "coaching",
      title: s.topic,
      startTime: s.start_time,
      status: s.status,
      counterpartName: s.coach_id ? namesById[s.coach_id] ?? null : null,
      sourceId: s.id,
      sourceType: "sessions",
    });
  }

  for (const p of peerRes.data ?? []) {
    const otherId = p.peer_coach_id === userId ? p.peer_coachee_id : p.peer_coach_id;
    items.push({
      id: `peer-${p.id}`,
      enrollmentId,
      type: "peer_coaching",
      title: p.topic,
      startTime: p.start_time,
      status: p.status,
      counterpartName: otherId ? namesById[otherId] ?? null : null,
      sourceId: p.id,
      sourceType: "peer_sessions",
    });
  }

  for (const m of mentoringRes.data ?? []) {
    items.push({
      id: `mentoring-${m.id}`,
      enrollmentId,
      type: "mentoring",
      title: m.topic,
      startTime: m.start_time,
      status: m.status,
      counterpartName: m.mentor_id ? namesById[m.mentor_id] ?? null : null,
      sourceId: m.id,
      sourceType: "mentoring_sessions",
    });
  }

  for (const t of triadRes.data ?? []) {
    const group = t.triad_groups as
      | { round_number: number | null; triad_rounds: { title: string | null; training_weeks: { week_number: number } | null } | null }
      | null;
    const roundNumber = group?.round_number ?? null;
    const weekNumber = group?.triad_rounds?.training_weeks?.week_number ?? null;
    items.push({
      id: `triad-${t.id}`,
      enrollmentId,
      type: "triad",
      title: roundNumber != null ? `Round ${roundNumber}` : "Triad session",
      startTime: t.start_time ?? t.proposed_start_time,
      status: t.status,
      sourceId: t.id,
      sourceType: "triad_sessions",
      roundLabel: roundNumber != null ? `Round ${roundNumber}` : null,
      trainingWeekLabel: weekNumber != null ? `Week ${weekNumber}` : null,
    });
  }

  return items.sort((a, b) => {
    const at = a.startTime ? new Date(a.startTime).getTime() : 0;
    const bt = b.startTime ? new Date(b.startTime).getTime() : 0;
    return bt - at;
  });
}

export function useEnrollmentSessions(enrollmentId: string | undefined, userId: string | undefined) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["enrollment-sessions-view", enrollmentId ?? null, userId ?? null],
    queryFn: () => fetchEnrollmentSessions(enrollmentId as string, userId as string),
    enabled: !!enrollmentId && !!userId,
    staleTime: 30_000,
  });

  return {
    sessions: data ?? [],
    loading: !!enrollmentId && !!userId && isLoading,
    error: error ? (error instanceof Error ? error.message : String(error)) : null,
  };
}
