import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const PRACTICE_COMPETENCY_KEYS = [
  "ethical_practice",
  "coaching_mindset",
  "maintains_agreements",
  "trust_safety",
  "maintains_presence",
  "listens_actively",
  "evokes_awareness",
  "facilitates_growth",
] as const;

export type PracticeCompetencyKey = (typeof PRACTICE_COMPETENCY_KEYS)[number];

export interface PracticeEntry {
  id: string;
  topic: string;
  start_time: string;
  duration_minutes: number;
  status: string;
  kind: "coached" | "peer-given" | "peer-received";
  counterpart_id: string;
  enrollment_id: string;
}

export interface PracticeFeedback {
  id: string;
  peer_session_id: string;
  created_at: string;
  feedback_note: string | null;
  peer_coachee_id: string;
  ethical_practice: number | null;
  coaching_mindset: number | null;
  maintains_agreements: number | null;
  trust_safety: number | null;
  maintains_presence: number | null;
  listens_actively: number | null;
  evokes_awareness: number | null;
  facilitates_growth: number | null;
}

/**
 * Practice & competency data for one enrollment: coached + peer-coaching
 * sessions (the "practice log") and peer_session_competency_feedback (the
 * only canonical source of per-ICF-competency scores this learner has — see
 * useLearnerFeedback's doc comment; triad_reflections carries only a single
 * overall satisfaction_rating, no per-competency breakdown, so it cannot
 * contribute competency scores here without fabricating structure the table
 * doesn't have).
 *
 * Shared by CoachPracticeJourney (the standalone page, still reachable by
 * both roles) and the coachee's My Journey "Practice & Competency
 * Analytics" tab — one query, two presentations, never two different
 * computations of the same facts.
 */
export function usePracticeAnalytics(enrollmentId: string | undefined, userId: string | undefined) {
  const [entries, setEntries] = useState<PracticeEntry[]>([]);
  const [feedback, setFeedback] = useState<PracticeFeedback[]>([]);
  const [profilesById, setProfilesById] = useState<Record<string, { full_name: string }>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId || !enrollmentId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const [{ data: coached }, { data: peer }] = await Promise.all([
        supabase
          .from("sessions")
          .select("id, topic, start_time, duration_minutes, status, coach_id, enrollment_id")
          .eq("coachee_id", userId)
          .eq("enrollment_id", enrollmentId),
        supabase
          .from("peer_sessions")
          .select("id, topic, start_time, duration_minutes, status, peer_coach_id, peer_coachee_id, enrollment_id")
          .or(`peer_coach_id.eq.${userId},peer_coachee_id.eq.${userId}`)
          .eq("enrollment_id", enrollmentId),
      ]);
      const scopedPeer = peer || [];
      const peerIds = scopedPeer.map((s) => s.id);
      const { data: fb } = peerIds.length
        ? await supabase
            .from("peer_session_competency_feedback")
            .select("*")
            .in("peer_session_id", peerIds)
            .eq("peer_coach_id", userId)
            .order("created_at", { ascending: true })
        : { data: [] };

      const list: PracticeEntry[] = [];
      (coached || []).forEach((s) =>
        list.push({
          id: s.id,
          topic: s.topic,
          start_time: s.start_time,
          duration_minutes: s.duration_minutes,
          status: s.status,
          kind: "coached",
          counterpart_id: s.coach_id,
          enrollment_id: enrollmentId,
        })
      );
      scopedPeer.forEach((s) =>
        list.push({
          id: s.id,
          topic: s.topic,
          start_time: s.start_time,
          duration_minutes: s.duration_minutes,
          status: s.status,
          kind: s.peer_coach_id === userId ? "peer-given" : "peer-received",
          counterpart_id: s.peer_coach_id === userId ? s.peer_coachee_id : s.peer_coach_id,
          enrollment_id: enrollmentId,
        })
      );
      list.sort((a, b) => +new Date(b.start_time) - +new Date(a.start_time));

      const ids = Array.from(
        new Set([...list.map((e) => e.counterpart_id), ...(fb || []).map((f) => f.peer_coachee_id)])
      );
      let map: Record<string, { full_name: string }> = {};
      if (ids.length) {
        const { data: profs } = await supabase.from("profiles").select("id, full_name").in("id", ids);
        map = Object.fromEntries((profs ?? []).map((p) => [p.id as string, { full_name: p.full_name as string }]));
      }

      if (cancelled) return;
      setEntries(list);
      setFeedback((fb || []) as PracticeFeedback[]);
      setProfilesById(map);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, enrollmentId]);

  const stats = useMemo(() => {
    const booked = entries.filter((e) => ["pending_coach_approval", "confirmed", "completed"].includes(e.status));
    const completed = entries.filter((e) => e.status === "completed");
    const tally = (kind: PracticeEntry["kind"], src: PracticeEntry[]) => src.filter((e) => e.kind === kind).length;
    return {
      coached: { booked: tally("coached", booked), completed: tally("coached", completed) },
      peerGiven: { booked: tally("peer-given", booked), completed: tally("peer-given", completed) },
      peerReceived: { booked: tally("peer-received", booked), completed: tally("peer-received", completed) },
    };
  }, [entries]);

  const competencyScores = useMemo(() => {
    return PRACTICE_COMPETENCY_KEYS.map((key) => {
      const vals = feedback.map((f) => f[key]).filter((v): v is number => v != null);
      const avg = vals.length ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length) : null;
      return { key, score: avg, observations: vals.length };
    });
  }, [feedback]);

  return { loading: loading || !enrollmentId, entries, feedback, profilesById, stats, competencyScores };
}
