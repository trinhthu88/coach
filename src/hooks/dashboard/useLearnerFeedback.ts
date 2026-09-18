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
 * - Shared session notes written by the other party — sessions.coach_notes
 *   (coach → coachee), mentoring_sessions.mentor_notes (mentor → mentee)
 *   and coachee_peer_sessions.provider_notes (peer provider → receiver).
 *   SessionDetail / MentoringSessionDetail already show exactly these
 *   fields to the learner read-only ("Coach note" / "Mentor notes"), so they
 *   are learner-visible by design. Their private counterparts
 *   (coach_private_notes, provider_private_notes) are author-only and are
 *   never selected here.
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
    }
  | {
      kind: "session_note";
      id: string;
      source: "coaching" | "mentoring" | "peer_practice";
      sessionId: string;
      topic: string | null;
      fromName: string | null;
      submittedAt: string;
      note: string;
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
  // peer_session_competency_feedback.peer_session_id carries no foreign key
  // to peer_sessions, so PostgREST cannot embed `peer_sessions!inner(...)`
  // from it (PGRST200) — that embed was why the Dashboard showed "Feedback
  // could not be loaded" even for learners with feedback. Resolve this
  // enrollment's peer sessions first, then read feedback for exactly those
  // ids. mentoring_feedback does have an FK to mentoring_sessions, so its
  // enrollment-scoped embed stays.
  const [
    { data: mentoring, error: mentoringError },
    { data: peerSessions, error: peerSessionsError },
    { data: coachingNotes, error: coachingNotesError },
    { data: mentorNotes, error: mentorNotesError },
    { data: peerPracticeNotes, error: peerPracticeNotesError },
  ] = await Promise.all([
    supabase
      .from("mentoring_feedback")
      .select(
        "id, mentor_id, overall_notes, submitted_at, ethical_practice, coaching_mindset, maintains_agreements, trust_safety, maintains_presence, listens_actively, evokes_awareness, facilitates_growth, mentoring_sessions!inner(enrollment_id)"
      )
      .eq("mentee_id", userId)
      .eq("mentoring_sessions.enrollment_id", enrollmentId)
      .order("submitted_at", { ascending: false })
      .limit(10),
    supabase.from("peer_sessions").select("id").eq("enrollment_id", enrollmentId).eq("peer_coach_id", userId),
    supabase
      .from("sessions")
      .select("id, topic, start_time, coach_id, coach_notes")
      .eq("enrollment_id", enrollmentId)
      .eq("coachee_id", userId)
      .not("coach_notes", "is", null),
    supabase
      .from("mentoring_sessions")
      .select("id, topic, start_time, mentor_id, mentor_notes")
      .eq("enrollment_id", enrollmentId)
      .eq("mentee_id", userId)
      .not("mentor_notes", "is", null),
    supabase
      .from("coachee_peer_sessions")
      .select("id, topic, start_time, peer_provider_id, provider_notes")
      .eq("enrollment_id", enrollmentId)
      .eq("peer_receiver_id", userId)
      .not("provider_notes", "is", null),
  ]);
  if (mentoringError) throw mentoringError;
  if (peerSessionsError) throw peerSessionsError;
  if (coachingNotesError) throw coachingNotesError;
  if (mentorNotesError) throw mentorNotesError;
  if (peerPracticeNotesError) throw peerPracticeNotesError;

  type NoteRow = { id: string; topic: string | null; start_time: string; author: string; note: string | null };
  const noteSources: Array<{ source: "coaching" | "mentoring" | "peer_practice"; rows: NoteRow[] }> = [
    {
      source: "coaching",
      rows: (coachingNotes ?? []).map((r) => ({ id: r.id, topic: r.topic, start_time: r.start_time, author: r.coach_id, note: r.coach_notes })),
    },
    {
      source: "mentoring",
      rows: (mentorNotes ?? []).map((r) => ({ id: r.id, topic: r.topic, start_time: r.start_time, author: r.mentor_id, note: r.mentor_notes })),
    },
    {
      source: "peer_practice",
      rows: (peerPracticeNotes ?? []).map((r) => ({ id: r.id, topic: r.topic, start_time: r.start_time, author: r.peer_provider_id, note: r.provider_notes })),
    },
  ];
  const sessionNotes = noteSources.flatMap(({ source, rows }) =>
    rows.filter((row) => row.note && row.note.trim()).map((row) => ({ source, row }))
  );

  const peerSessionIds = (peerSessions ?? []).map((row) => row.id as string);
  let peer: Array<Record<string, unknown>> = [];
  if (peerSessionIds.length > 0) {
    const { data, error: peerError } = await supabase
      .from("peer_session_competency_feedback")
      .select(
        "id, peer_coachee_id, feedback_note, created_at, ethical_practice, coaching_mindset, maintains_agreements, trust_safety, maintains_presence, listens_actively, evokes_awareness, facilitates_growth"
      )
      .eq("peer_coach_id", userId)
      .in("peer_session_id", peerSessionIds)
      .order("created_at", { ascending: false })
      .limit(10);
    if (peerError) throw peerError;
    peer = (data ?? []) as Array<Record<string, unknown>>;
  }

  const authorIds = Array.from(
    new Set([
      ...(mentoring ?? []).map((row) => row.mentor_id as string),
      ...(peer ?? []).map((row) => row.peer_coachee_id as string),
      ...sessionNotes.map(({ row }) => row.author),
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

  const noteItems: LearnerFeedbackItem[] = sessionNotes.map(({ source, row }) => ({
    kind: "session_note" as const,
    id: `${source}-${row.id}`,
    source,
    sessionId: row.id,
    topic: row.topic,
    fromName: namesById[row.author] ?? null,
    submittedAt: row.start_time,
    note: (row.note as string).trim(),
  }));

  return [...mentoringItems, ...peerItems, ...noteItems].sort(
    (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
  );
}

export function useLearnerFeedback(userId: string | undefined, enrollmentId: string | undefined) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["learner-feedback", userId ?? null, enrollmentId ?? null],
    queryFn: () =>
      fetchLearnerFeedback(userId as string, enrollmentId as string).catch((cause: unknown) => {
        console.error("Learner feedback failed to load", { enrollmentId, cause });
        throw cause;
      }),
    enabled: !!userId && !!enrollmentId,
    staleTime: 30_000,
  });

  return {
    feedback: data ?? [],
    loading: !!userId && !!enrollmentId && isLoading,
    error: error
      ? error instanceof Error
        ? error.message
        : typeof error === "object" && "message" in error
          ? String((error as { message: unknown }).message)
          : String(error)
      : null,
  };
}
