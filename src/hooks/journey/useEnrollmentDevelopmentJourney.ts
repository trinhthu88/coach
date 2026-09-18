import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { DevelopmentJourneyEvent } from "./developmentJourneyTypes";

type TriadGroupContext = {
  round_number: number | null;
  triad_rounds: { title: string | null; training_weeks: { week_number: number } | null } | null;
} | null;

/**
 * Round/week context only when the canonical relationship actually resolves
 * one (triad_sessions -> triad_groups -> triad_rounds [-> training_weeks]) —
 * a missing group/round/week link keeps the generic label rather than
 * guessing a number. Shared by the triad-session and triad-self-reflection
 * event builders so the two surfaces never disagree on the same context.
 */
function resolveTriadRoundWeek(group: TriadGroupContext) {
  const roundNumber = group?.round_number ?? null;
  const weekNumber = group?.triad_rounds?.training_weeks?.week_number ?? null;
  return { roundNumber, weekNumber, roundTitle: group?.triad_rounds?.title ?? null };
}

/**
 * The single Development Journey projection: every event is read directly
 * from its canonical table, scoped to one enrollment_id, and converted to a
 * DevelopmentJourneyEvent — nothing is computed twice. This is the ONE
 * source both the Journey page's timeline and the Dashboard's "Recent
 * Development" must consume (Dashboard = first N of this same array, never
 * a second query or a different calculation).
 *
 * Sources (all filtered by enrollment_id):
 *  goal            -> coachee_goals, coachee_milestones, goal_checkins
 *  action          -> enrollment_actions (canonical; never legacy session JSON)
 *  coaching        -> sessions (+ coachee_notes as a "reflection" sub-event)
 *  peer_coaching   -> peer_sessions (+ peer_session_competency_feedback via session ids)
 *  mentoring       -> mentoring_sessions (+ mentee_notes, + mentoring_feedback)
 *  triad           -> triad_sessions (coach/coachee/observer enrollment columns)
 *                     + triad_reflections (learner self-reflection/self-rating; own enrollment_id column)
 *  training        -> training_progress, assignment_submissions (quiz), reflection_submissions
 *  reflection      -> coachee_reflections (private, enrollment-scoped)
 */
interface DevelopmentJourneyResult {
  events: DevelopmentJourneyEvent[];
  /** Canonical sources whose query failed — their events are missing, not empty. */
  failedSources: string[];
}

async function fetchDevelopmentJourney(enrollmentId: string, coacheeId: string): Promise<DevelopmentJourneyResult> {
  const [
    goalsRes,
    milestonesRes,
    checkinsRes,
    actionsRes,
    sessionsRes,
    peerRes,
    mentoringRes,
    triadRes,
    triadReflectionRes,
    trainingRes,
    quizRes,
    programmeReflectionRes,
    privateReflectionRes,
  ] = await Promise.all([
    supabase.from("coachee_goals").select("id, title, status, created_at").eq("enrollment_id", enrollmentId),
    supabase.from("coachee_milestones").select("id, goal_id, title, is_done, done_at, created_at").eq("enrollment_id", enrollmentId),
    supabase.from("goal_checkins").select("id, goal_id, source_activity_type, source_activity_id, new_rating, note, created_at").eq("enrollment_id", enrollmentId),
    supabase.from("enrollment_actions").select("id, title, status, goal_id, milestone_id, created_at, completed_at").eq("enrollment_id", enrollmentId),
    supabase.from("sessions").select("id, topic, status, start_time, coachee_notes").eq("enrollment_id", enrollmentId),
    supabase.from("peer_sessions").select("id, topic, status, start_time").eq("enrollment_id", enrollmentId),
    supabase.from("mentoring_sessions").select("id, topic, status, start_time, mentee_notes").eq("enrollment_id", enrollmentId),
    supabase
      .from("triad_sessions")
      .select(
        "id, status, start_time, proposed_start_time, triad_groups(round_number, triad_rounds(title, training_weeks(week_number)))"
      )
      .or(`coach_enrollment_id.eq.${enrollmentId},coachee_enrollment_id.eq.${enrollmentId},observer_enrollment_id.eq.${enrollmentId}`),
    supabase
      .from("triad_reflections")
      .select(
        "id, satisfaction_rating, learned_as_coach, will_use_as_coach, learned_as_coachee, will_use_as_coachee, learned_as_observer, will_use_as_observer, submitted_at, triad_sessions(triad_groups(round_number, triad_rounds(title, training_weeks(week_number))))"
      )
      .eq("enrollment_id", enrollmentId),
    supabase
      .from("training_progress")
      .select("id, training_week_id, completed_at, training_weeks(title, week_number)")
      .eq("enrollment_id", enrollmentId)
      .not("completed_at", "is", null),
    supabase
      .from("assignment_submissions")
      .select("id, score_pct, submitted_at, assignments(title, assignment_type, training_week_id)")
      .eq("enrollment_id", enrollmentId),
    supabase
      .from("reflection_submissions")
      .select("id, submitted_at, programme_reflections(title, reflection_number)")
      .eq("enrollment_id", enrollmentId),
    supabase.from("coachee_reflections").select("id, body, mood, created_at").eq("coachee_id", coacheeId).eq("enrollment_id", enrollmentId),
  ]);

  const sourceResults: Record<string, { error: unknown }> = {
    coachee_goals: goalsRes,
    coachee_milestones: milestonesRes,
    goal_checkins: checkinsRes,
    enrollment_actions: actionsRes,
    sessions: sessionsRes,
    peer_sessions: peerRes,
    mentoring_sessions: mentoringRes,
    triad_sessions: triadRes,
    triad_reflections: triadReflectionRes,
    training_progress: trainingRes,
    assignment_submissions: quizRes,
    reflection_submissions: programmeReflectionRes,
    coachee_reflections: privateReflectionRes,
  };
  const failedSources = Object.entries(sourceResults)
    .filter(([, res]) => res?.error)
    .map(([source]) => source);

  const events: DevelopmentJourneyEvent[] = [];

  for (const g of goalsRes.data ?? []) {
    events.push({
      id: `goal-created-${g.id}`,
      enrollmentId,
      occurredAt: g.created_at,
      type: "goal",
      subtype: "goal_created",
      title: "Goal created",
      summary: g.title,
      status: g.status,
      sourceId: g.id,
      sourceType: "coachee_goals",
      goalId: g.id,
    });
  }

  for (const m of milestonesRes.data ?? []) {
    events.push({
      id: `milestone-created-${m.id}`,
      enrollmentId,
      occurredAt: m.created_at,
      type: "goal",
      subtype: "milestone_created",
      title: "Milestone added",
      summary: m.title,
      sourceId: m.id,
      sourceType: "coachee_milestones",
      goalId: m.goal_id,
      milestoneId: m.id,
    });
    if (m.is_done && m.done_at) {
      events.push({
        id: `milestone-done-${m.id}`,
        enrollmentId,
        occurredAt: m.done_at,
        type: "goal",
        subtype: "milestone_completed",
        title: "Milestone completed",
        summary: m.title,
        status: "completed",
        sourceId: m.id,
        sourceType: "coachee_milestones",
        goalId: m.goal_id,
        milestoneId: m.id,
      });
    }
  }

  for (const c of checkinsRes.data ?? []) {
    events.push({
      id: `checkin-${c.id}`,
      enrollmentId,
      occurredAt: c.created_at,
      type: "goal",
      subtype: "goal_checkin",
      title: "Goal rating updated",
      summary: c.note ?? (c.new_rating != null ? `Rated ${c.new_rating}/100` : null),
      sourceId: c.id,
      sourceType: "goal_checkins",
      goalId: c.goal_id,
    });
  }

  for (const a of actionsRes.data ?? []) {
    events.push({
      id: `action-created-${a.id}`,
      enrollmentId,
      occurredAt: a.created_at,
      type: "action",
      subtype: "action_created",
      title: "Action agreed",
      summary: a.title,
      status: a.status,
      sourceId: a.id,
      sourceType: "enrollment_actions",
      goalId: a.goal_id,
      milestoneId: a.milestone_id,
    });
    if (a.status === "completed" && a.completed_at) {
      events.push({
        id: `action-done-${a.id}`,
        enrollmentId,
        occurredAt: a.completed_at,
        type: "action",
        subtype: "action_completed",
        title: "Action completed",
        summary: a.title,
        status: "completed",
        sourceId: a.id,
        sourceType: "enrollment_actions",
        goalId: a.goal_id,
        milestoneId: a.milestone_id,
      });
    }
  }

  for (const s of sessionsRes.data ?? []) {
    if (s.status === "completed") {
      events.push({
        id: `coaching-${s.id}`,
        enrollmentId,
        occurredAt: s.start_time,
        type: "coaching",
        subtype: "session_completed",
        title: "Coaching session completed",
        summary: s.topic,
        status: s.status,
        sourceId: s.id,
        sourceType: "sessions",
      });
      if (s.coachee_notes && s.coachee_notes.trim()) {
        events.push({
          id: `coaching-reflection-${s.id}`,
          enrollmentId,
          occurredAt: s.start_time,
          type: "reflection",
          subtype: "coaching_reflection",
          title: "Coaching reflection",
          summary: s.coachee_notes,
          sourceId: s.id,
          sourceType: "sessions",
        });
      }
    }
  }

  const peerSessionIds = (peerRes.data ?? []).map((p) => p.id as string);
  const { data: peerFeedback, error: peerFeedbackError } = peerSessionIds.length
    ? await supabase
        .from("peer_session_competency_feedback")
        .select("id, peer_session_id, feedback_note, created_at")
        .in("peer_session_id", peerSessionIds)
    : { data: [] as { id: string; peer_session_id: string; feedback_note: string | null; created_at: string }[], error: null };
  if (peerFeedbackError) failedSources.push("peer_session_competency_feedback");

  for (const p of peerRes.data ?? []) {
    if (p.status === "completed") {
      events.push({
        id: `peer-${p.id}`,
        enrollmentId,
        occurredAt: p.start_time,
        type: "peer_coaching",
        subtype: "session_completed",
        title: "Peer coaching completed",
        summary: p.topic,
        status: p.status,
        sourceId: p.id,
        sourceType: "peer_sessions",
      });
    }
  }
  for (const f of peerFeedback ?? []) {
    events.push({
      id: `peer-feedback-${f.id}`,
      enrollmentId,
      occurredAt: f.created_at,
      type: "feedback",
      subtype: "peer_competency_feedback",
      title: "Peer competency feedback received",
      summary: f.feedback_note,
      sourceId: f.id,
      sourceType: "peer_session_competency_feedback",
    });
  }

  const mentoringSessionIds = (mentoringRes.data ?? []).map((m) => m.id as string);
  const { data: mentoringFeedback, error: mentoringFeedbackError } = mentoringSessionIds.length
    ? await supabase
        .from("mentoring_feedback")
        .select("id, mentoring_session_id, overall_notes, submitted_at")
        .in("mentoring_session_id", mentoringSessionIds)
    : { data: [] as { id: string; mentoring_session_id: string; overall_notes: string | null; submitted_at: string }[], error: null };
  if (mentoringFeedbackError) failedSources.push("mentoring_feedback");

  for (const m of mentoringRes.data ?? []) {
    if (m.status === "completed") {
      events.push({
        id: `mentoring-${m.id}`,
        enrollmentId,
        occurredAt: m.start_time,
        type: "mentoring",
        subtype: "session_completed",
        title: "Mentoring session completed",
        summary: m.topic,
        status: m.status,
        sourceId: m.id,
        sourceType: "mentoring_sessions",
      });
      if (m.mentee_notes && m.mentee_notes.trim()) {
        events.push({
          id: `mentoring-reflection-${m.id}`,
          enrollmentId,
          occurredAt: m.start_time,
          type: "reflection",
          subtype: "mentoring_reflection",
          title: "Mentoring reflection",
          summary: m.mentee_notes,
          sourceId: m.id,
          sourceType: "mentoring_sessions",
        });
      }
    }
  }
  for (const f of mentoringFeedback ?? []) {
    events.push({
      id: `mentoring-feedback-${f.id}`,
      enrollmentId,
      occurredAt: f.submitted_at,
      type: "feedback",
      subtype: "mentoring_feedback",
      title: "Mentor feedback received",
      summary: f.overall_notes,
      sourceId: f.id,
      sourceType: "mentoring_feedback",
    });
  }

  for (const t of triadRes.data ?? []) {
    if (t.status === "completed") {
      const group = t.triad_groups as TriadGroupContext;
      const { roundNumber, weekNumber, roundTitle } = resolveTriadRoundWeek(group);
      const title =
        roundNumber != null && weekNumber != null
          ? `Triad — Week ${weekNumber} / Round ${roundNumber}`
          : roundNumber != null
            ? `Triad — Round ${roundNumber}`
            : "Triad completed";
      events.push({
        id: `triad-${t.id}`,
        enrollmentId,
        occurredAt: t.start_time ?? t.proposed_start_time ?? new Date().toISOString(),
        type: "triad",
        subtype: "session_completed",
        title,
        summary: roundTitle,
        status: t.status,
        sourceId: t.id,
        sourceType: "triad_sessions",
      });
    }
  }

  // The learner assessing themselves — a REFLECTION, never FEEDBACK (feedback
  // is another participant assessing the learner, and no such canonical
  // Triad-feedback record exists). Resolves through triad_reflections' own
  // enrollment_id, scoped to this enrollment directly (not by participant_id
  // alone), so it never leaks in based on identity rather than membership.
  for (const r of triadReflectionRes.data ?? []) {
    const session = r.triad_sessions as { triad_groups: TriadGroupContext } | null;
    const { roundNumber, weekNumber } = resolveTriadRoundWeek(session?.triad_groups ?? null);
    const title =
      roundNumber != null && weekNumber != null
        ? `Triad Self-Reflection — Week ${weekNumber} / Round ${roundNumber}`
        : roundNumber != null
          ? `Triad Self-Reflection — Round ${roundNumber}`
          : "Triad Self-Reflection";
    const textPreview = [
      r.learned_as_coach,
      r.will_use_as_coach,
      r.learned_as_coachee,
      r.will_use_as_coachee,
      r.learned_as_observer,
      r.will_use_as_observer,
    ].find((v) => v && v.trim());
    const summary = r.satisfaction_rating != null ? `Self-rating: ${r.satisfaction_rating}/5` : textPreview ?? null;
    events.push({
      id: `triad-reflection-${r.id}`,
      enrollmentId,
      occurredAt: r.submitted_at,
      type: "reflection",
      subtype: "triad_self_reflection",
      title,
      summary,
      sourceId: r.id,
      sourceType: "triad_reflections",
    });
  }

  for (const w of trainingRes.data ?? []) {
    const week = w.training_weeks as { title: string; week_number: number } | null;
    events.push({
      id: `training-${w.id}`,
      enrollmentId,
      occurredAt: w.completed_at as string,
      type: "training",
      subtype: "training_week_completed",
      title: "Training completed",
      summary: week ? `Week ${week.week_number}: ${week.title}` : null,
      sourceId: w.id,
      sourceType: "training_progress",
    });
  }

  for (const q of quizRes.data ?? []) {
    const assignment = q.assignments as { title: string; assignment_type: string; training_week_id: string | null } | null;
    if (assignment?.assignment_type !== "quiz") continue;
    events.push({
      id: `quiz-${q.id}`,
      enrollmentId,
      occurredAt: q.submitted_at,
      type: "training",
      subtype: "quiz_submitted",
      title: "Quiz submitted",
      summary: q.score_pct != null ? `${assignment?.title ?? "Quiz"} — ${Math.round(q.score_pct)}%` : assignment?.title,
      sourceId: q.id,
      sourceType: "assignment_submissions",
    });
  }

  for (const r of programmeReflectionRes.data ?? []) {
    const reflection = r.programme_reflections as { title: string; reflection_number: number } | null;
    events.push({
      id: `programme-reflection-${r.id}`,
      enrollmentId,
      occurredAt: r.submitted_at,
      type: "reflection",
      subtype: "programme_reflection",
      title: "Programme reflection submitted",
      summary: reflection?.title,
      sourceId: r.id,
      sourceType: "reflection_submissions",
    });
  }

  for (const p of privateReflectionRes.data ?? []) {
    events.push({
      id: `private-reflection-${p.id}`,
      enrollmentId,
      occurredAt: p.created_at,
      type: "reflection",
      subtype: "private_reflection",
      title: "Private reflection",
      summary: p.body,
      sourceId: p.id,
      sourceType: "coachee_reflections",
    });
  }

  if (failedSources.length > 0) {
    console.error("Development journey sources failed to load", { enrollmentId, failedSources });
  }

  return {
    events: events.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()),
    failedSources,
  };
}

/**
 * The learner Development Journey timeline for one enrollment. Both the
 * Journey page's full timeline and the Dashboard's "Recent Development"
 * must call this hook and slice the same array — never compute a separate
 * history.
 */
export function useEnrollmentDevelopmentJourney(enrollmentId: string | undefined, coacheeId: string | undefined) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["development-journey", enrollmentId ?? null, coacheeId ?? null],
    queryFn: () => fetchDevelopmentJourney(enrollmentId as string, coacheeId as string),
    enabled: !!enrollmentId && !!coacheeId,
    staleTime: 30_000,
  });

  return {
    events: data?.events ?? [],
    loading: !!enrollmentId && !!coacheeId && isLoading,
    error: error ? (error instanceof Error ? error.message : String(error)) : null,
    /** Some sources failed: `events` is incomplete and must not be presented as the full history. */
    partialFailure: (data?.failedSources.length ?? 0) > 0,
  };
}
