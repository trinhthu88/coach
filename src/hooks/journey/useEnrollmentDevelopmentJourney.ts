import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { DevelopmentJourneyEvent } from "./developmentJourneyTypes";

interface DevelopmentJourneyResult {
  events: DevelopmentJourneyEvent[];
  /** Canonical sources whose query failed — their events are missing, not empty. */
  failedSources: string[];
}

const REFLECTION_TITLE: Record<string, string> = {
  coaching_session_reflection: "Coaching reflection",
  coaching_session_rating: "Coaching session rating",
  peer_session_reflection: "Peer practice reflection",
  peer_session_rating: "Peer practice rating",
  mentoring_session_reflection: "Mentoring reflection",
  triad_reflection: "Triad Self-Reflection",
  training_reflection: "Programme reflection",
  quiz_reflection: "Quiz reflection",
  daily_prompt_response: "Daily prompt response",
  journey_reflection: "Private reflection",
};

function triadTitle(prefix: string, fallback: string, roundNumber: number | null, weekNumber: number | null) {
  if (roundNumber != null && weekNumber != null) return `${prefix} — Week ${weekNumber} / Round ${roundNumber}`;
  if (roundNumber != null) return `${prefix} — Round ${roundNumber}`;
  return fallback;
}

/**
 * The single Development Journey projection: every event is derived from a
 * canonical record scoped to one enrollment and converted to a
 * DevelopmentJourneyEvent — nothing is computed twice. This is the ONE
 * source both the Journey page's timeline and the Dashboard's "Recent
 * Development" consume (Dashboard = first N of this same array).
 *
 * Sources (all enrollment-scoped):
 *  goal       -> coachee_goals, coachee_milestones, goal_checkins
 *  action     -> enrollment_actions (canonical; never legacy session JSON)
 *  sessions   -> learner_session_history (completed coaching / peer practice /
 *                mentoring / triad records — the same projection the session
 *                lists use; peer practice from coachee_peer_sessions)
 *  feedback   -> mentoring_feedback, peer_session_competency_feedback (by the
 *                enrollment's session ids)
 *  training   -> training_progress, assignment_submissions (quiz),
 *                reflection_submissions (submission activity)
 *  reflection -> learner_reflection_feed (the canonical learner reflection
 *                projection My Journey → Reflections renders). Goal check-in
 *                comments are carried by their goal_checkin event instead of
 *                being repeated as a separate reflection event.
 */
async function fetchDevelopmentJourney(enrollmentId: string, coacheeId: string): Promise<DevelopmentJourneyResult> {
  const [
    goalsRes,
    milestonesRes,
    checkinsRes,
    actionsRes,
    historyRes,
    reflectionFeedRes,
    trainingRes,
    quizRes,
    programmeReflectionRes,
  ] = await Promise.all([
    supabase.from("coachee_goals").select("id, title, status, created_at").eq("enrollment_id", enrollmentId).eq("coachee_id", coacheeId),
    supabase.from("coachee_milestones").select("id, goal_id, title, is_done, done_at, created_at").eq("enrollment_id", enrollmentId),
    supabase.from("goal_checkins").select("id, goal_id, source_activity_type, source_activity_id, new_rating, note, created_at").eq("enrollment_id", enrollmentId),
    supabase.from("enrollment_actions").select("id, title, status, goal_id, milestone_id, created_at, completed_at").eq("enrollment_id", enrollmentId),
    supabase.rpc("learner_session_history", { p_enrollment_id: enrollmentId }),
    supabase.rpc("learner_reflection_feed", { p_enrollment_id: enrollmentId }),
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
  ]);

  const sourceResults: Record<string, { error: unknown }> = {
    coachee_goals: goalsRes,
    coachee_milestones: milestonesRes,
    goal_checkins: checkinsRes,
    enrollment_actions: actionsRes,
    learner_session_history: historyRes,
    learner_reflection_feed: reflectionFeedRes,
    training_progress: trainingRes,
    assignment_submissions: quizRes,
    reflection_submissions: programmeReflectionRes,
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

  // Completed sessions, from the same history projection the session lists use.
  const history = historyRes.data ?? [];
  for (const h of history) {
    if (h.status !== "completed" || !h.start_time) continue;
    const base = {
      id: `${h.session_type}-${h.source_id}`,
      enrollmentId,
      occurredAt: h.start_time,
      subtype: "session_completed",
      status: h.status,
      sourceId: h.source_id,
      sourceType: h.source_table,
    };
    if (h.session_type === "coaching") {
      events.push({ ...base, type: "coaching", title: "Coaching session completed", summary: h.title });
    } else if (h.session_type === "peer_coaching") {
      events.push({
        ...base,
        type: "peer_coaching",
        title: h.participant_role === "provider" ? "Peer practice given" : "Peer coaching completed",
        summary: h.title,
      });
    } else if (h.session_type === "mentoring") {
      events.push({ ...base, type: "mentoring", title: "Mentoring session completed", summary: h.title });
    } else if (h.session_type === "triad") {
      events.push({
        ...base,
        type: "triad",
        title: triadTitle("Triad", "Triad completed", h.round_number, h.training_week_number),
        summary: h.title,
      });
    }
  }

  // Feedback on this enrollment's sessions (other participants assessing the learner).
  const peerSessionIds = history.filter((h) => h.source_table === "peer_sessions").map((h) => h.source_id);
  const mentoringSessionIds = history.filter((h) => h.source_table === "mentoring_sessions").map((h) => h.source_id);
  const [peerFeedbackRes, mentoringFeedbackRes] = await Promise.all([
    peerSessionIds.length
      ? supabase
          .from("peer_session_competency_feedback")
          .select("id, peer_session_id, feedback_note, created_at")
          .in("peer_session_id", peerSessionIds)
      : Promise.resolve({ data: [] as { id: string; peer_session_id: string; feedback_note: string | null; created_at: string }[], error: null }),
    mentoringSessionIds.length
      ? supabase
          .from("mentoring_feedback")
          .select("id, mentoring_session_id, overall_notes, submitted_at")
          .in("mentoring_session_id", mentoringSessionIds)
      : Promise.resolve({ data: [] as { id: string; mentoring_session_id: string; overall_notes: string | null; submitted_at: string }[], error: null }),
  ]);
  if (peerFeedbackRes.error) failedSources.push("peer_session_competency_feedback");
  if (mentoringFeedbackRes.error) failedSources.push("mentoring_feedback");

  for (const f of peerFeedbackRes.data ?? []) {
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
  for (const f of mentoringFeedbackRes.data ?? []) {
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

  // Submitting a programme reflection is learning ACTIVITY; its written
  // answers (if any) are a reflection and come from the feed below.
  for (const r of programmeReflectionRes.data ?? []) {
    const reflection = r.programme_reflections as { title: string; reflection_number: number } | null;
    events.push({
      id: `programme-reflection-${r.id}`,
      enrollmentId,
      occurredAt: r.submitted_at,
      type: "training",
      subtype: "programme_reflection_submitted",
      title: "Programme reflection submitted",
      summary: reflection?.title,
      sourceId: r.id,
      sourceType: "reflection_submissions",
    });
  }

  for (const f of reflectionFeedRes.data ?? []) {
    if (f.source_type === "goal_checkin") continue;
    const details = (f.details && typeof f.details === "object" && !Array.isArray(f.details) ? f.details : {}) as Record<string, unknown>;
    const roundNumber = typeof details.round_number === "number" ? details.round_number : null;
    events.push({
      id: `reflection-${f.reflection_key}`,
      enrollmentId,
      occurredAt: f.occurred_at,
      type: "reflection",
      subtype: f.source_type,
      title:
        f.source_type === "triad_reflection"
          ? triadTitle("Triad Self-Reflection", "Triad Self-Reflection", roundNumber, null)
          : REFLECTION_TITLE[f.source_type] ?? "Reflection",
      summary: f.body,
      sourceId: f.source_id,
      sourceType: f.source_table,
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
