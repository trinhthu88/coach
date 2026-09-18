import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Learner-visible feedback only, scoped to one enrollment.
 *
 * Sources audited:
 * - mentoring_feedback: RLS grants the mentee (`mentee_id = auth.uid()`)
 *   read access to their mentor's written feedback — learner-visible.
 *   Neither this table nor mentoring_sessions carries a direct FK to it, so
 *   enrollment scoping joins through mentoring_sessions.enrollment_id.
 * - peer_session_competency_feedback: RLS grants both participants read
 *   access; rows where this learner is `peer_coach_id` are competency
 *   ratings ABOUT them from the peer they coached — learner-visible.
 *   Scoped the same way, through peer_sessions.enrollment_id.
 * - coach_session_feedback is deliberately NOT queried here: its RLS only
 *   grants the authoring coach and admins access (quality_rating,
 *   engagement_level, flag_notes are private coach/admin assessment, never
 *   learner-visible), so there is no learner-safe way to read it and none
 *   should be added.
 *
 * A learner with more than one enrollment (e.g. re-enrolled in a later
 * cohort) must only see feedback that belongs to the selected enrollment —
 * without this join, feedback from every enrollment they've ever had would
 * be mixed together regardless of which one is currently open.
 */
export type LearnerFeedbackItem =
  | {
      kind: "mentoring";
      id: string;
      fromName: string | null;
      submittedAt: string;
      overallNotes: string | null;
      competencies: { key: string; note: string }[];
    }
  | {
      kind: "peer_competency";
      id: string;
      fromName: string | null;
      submittedAt: string;
      note: string | null;
      scores: { key: string; score: number }[];
    };

const COMPETENCY_KEYS = [
  "ethical_practice",
  "coaching_mindset",
  "maintains_agreements",
  "trust_safety",
  "maintains_presence",
  "listens_actively",
  "evokes_awareness",
  "facilitates_growth",
] as const;

async function fetchLearnerFeedback(userId: string, enrollmentId: string): Promise<LearnerFeedbackItem[]> {
  const [{ data: mentoring, error: mentoringError }, { data: peer, error: peerError }] = await Promise.all([
    supabase
      .from("mentoring_feedback")
      .select(
        "id, mentor_id, overall_notes, submitted_at, ethical_practice, coaching_mindset, maintains_agreements, trust_safety, maintains_presence, listens_actively, evokes_awareness, facilitates_growth, mentoring_sessions!inner(enrollment_id)"
      )
      .eq("mentee_id", userId)
      .eq("mentoring_sessions.enrollment_id", enrollmentId)
      .order("submitted_at", { ascending: false })
      .limit(10),
    supabase
      .from("peer_session_competency_feedback")
      .select(
        "id, peer_coachee_id, feedback_note, created_at, ethical_practice, coaching_mindset, maintains_agreements, trust_safety, maintains_presence, listens_actively, evokes_awareness, facilitates_growth, peer_sessions!inner(enrollment_id)"
      )
      .eq("peer_coach_id", userId)
      .eq("peer_sessions.enrollment_id", enrollmentId)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);
  if (mentoringError) throw mentoringError;
  if (peerError) throw peerError;

  const authorIds = Array.from(
    new Set([
      ...(mentoring ?? []).map((row) => row.mentor_id as string),
      ...(peer ?? []).map((row) => row.peer_coachee_id as string),
    ])
  );
  const namesById: Record<string, string> = {};
  if (authorIds.length > 0) {
    const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", authorIds);
    for (const p of profiles ?? []) namesById[p.id as string] = p.full_name as string;
  }

  const mentoringItems: LearnerFeedbackItem[] = (mentoring ?? []).map((row) => ({
    kind: "mentoring" as const,
    id: row.id as string,
    fromName: namesById[row.mentor_id as string] ?? null,
    submittedAt: row.submitted_at as string,
    overallNotes: (row.overall_notes as string | null) ?? null,
    competencies: COMPETENCY_KEYS.filter((key) => row[key]).map((key) => ({ key, note: row[key] as string })),
  }));

  const peerItems: LearnerFeedbackItem[] = (peer ?? []).map((row) => ({
    kind: "peer_competency" as const,
    id: row.id as string,
    fromName: namesById[row.peer_coachee_id as string] ?? null,
    submittedAt: row.created_at as string,
    note: (row.feedback_note as string | null) ?? null,
    scores: COMPETENCY_KEYS.filter((key) => row[key] != null).map((key) => ({ key, score: row[key] as number })),
  }));

  return [...mentoringItems, ...peerItems].sort(
    (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
  );
}

export function useLearnerFeedback(userId: string | undefined, enrollmentId: string | undefined) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["learner-feedback", userId ?? null, enrollmentId ?? null],
    queryFn: () => fetchLearnerFeedback(userId as string, enrollmentId as string),
    enabled: !!userId && !!enrollmentId,
    staleTime: 30_000,
  });

  return {
    feedback: data ?? [],
    loading: !!userId && !!enrollmentId && isLoading,
    error: error ? (error instanceof Error ? error.message : String(error)) : null,
  };
}
