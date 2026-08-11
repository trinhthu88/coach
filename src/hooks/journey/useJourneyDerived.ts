import { useCallback, useMemo } from "react";
import { differenceInCalendarWeeks } from "date-fns";
import type { Goal, GoalRating, Milestone, ProgrammeInfo, SessionGoalRating } from "./types";
import type { GoalRatingRow, SessionRatingSeries } from "@/pages/journey/GoalWheel";

/** Milestone completion percentage across all of a coachee's goals. */
export function useMilestoneProgress(milestones: Milestone[]) {
  const totalMs = milestones.length;
  const doneMs = milestones.filter((m) => m.is_done).length;
  const overallPct = totalMs ? Math.round((doneMs / totalMs) * 100) : 0;
  return { totalMs, doneMs, overallPct };
}

/** Goal-wheel rating rows (start/current/target) plus the average progress across goals. */
export function useGoalRatingRows(goals: Goal[], ratings: Record<string, GoalRating>) {
  const ratingRows: GoalRatingRow[] = useMemo(
    () =>
      goals.map((g) => {
        const r = ratings[g.id];
        return {
          goalId: g.id,
          title: g.title,
          start: r?.start_rating ?? 30,
          current: r?.current_rating ?? 30,
          target: r?.target_rating ?? 80,
        };
      }),
    [goals, ratings]
  );

  const avgGoalProgress = useMemo(() => {
    if (!ratingRows.length) return 0;
    const vals = ratingRows.map((r) => {
      const span = Math.max(1, r.target - r.start);
      const got = Math.max(0, r.current - r.start);
      return Math.min(100, Math.round((got / span) * 100));
    });
    return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  }, [ratingRows]);

  return { ratingRows, avgGoalProgress };
}

/** Elapsed/total weeks for a programme enrollment, derived from its start/end dates. */
export function useProgrammeWeeks(programme: ProgrammeInfo | null | undefined, now: Date) {
  return useMemo(() => {
    if (!programme?.startDate) return null;
    const start = new Date(programme.startDate);
    const end = programme.endDate
      ? new Date(programme.endDate)
      : new Date(start.getTime() + (programme.durationMonths || 3) * 30 * 86400000);
    const totalWeeks = Math.max(1, differenceInCalendarWeeks(end, start, { weekStartsOn: 1 }));
    const elapsedWeeks = Math.max(0, Math.min(totalWeeks, differenceInCalendarWeeks(now, start, { weekStartsOn: 1 })));
    return { start, end, totalWeeks, elapsedWeeks };
  }, [programme, now]);
}

interface LockableSession {
  status: string;
  start_time: string;
}

/**
 * A goal's Start/Target ratings lock once the coachee completes a session
 * that took place after the goal was created — this lets people add new
 * goals later in the programme without instantly locking them.
 */
export function useGoalLock<S extends LockableSession>(sessions: S[]) {
  const completedSessionTimes = useMemo(
    () => sessions.filter((s) => s.status === "completed").map((s) => new Date(s.start_time).getTime()),
    [sessions]
  );
  const isGoalLocked = useCallback(
    (goalCreatedAt: string) => {
      const created = new Date(goalCreatedAt).getTime();
      return completedSessionTimes.some((t) => t > created);
    },
    [completedSessionTimes]
  );
  return { isGoalLocked };
}

interface RatedSession {
  id: string;
  start_time: string;
}

/** Per-session rating snapshots, ordered oldest -> newest, joined to session date. */
export function useSessionRatingSeries<S extends RatedSession>(
  sessionRatings: SessionGoalRating[],
  sessions: S[]
) {
  return useMemo<SessionRatingSeries[]>(() => {
    const sessionById = new Map(sessions.map((s) => [s.id, s]));
    const grouped = new Map<string, { date: string; rows: { goalId: string; rating: number }[] }>();
    for (const row of sessionRatings) {
      const sess = sessionById.get(row.session_id);
      if (!sess) continue;
      const cur = grouped.get(row.session_id) || { date: sess.start_time, rows: [] };
      cur.rows.push({ goalId: row.goal_id, rating: row.rating });
      grouped.set(row.session_id, cur);
    }
    return Array.from(grouped.entries())
      .map(([sessionId, v]) => ({ sessionId, date: v.date, rows: v.rows }))
      .sort((a, b) => +new Date(a.date) - +new Date(b.date));
  }, [sessionRatings, sessions]);
}

interface PendingReflectionSession {
  id: string;
  status: string;
  start_time: string;
  _source?: "coaching" | "peer";
}

/**
 * After a completed coaching session, prompt to add the latest reflection
 * rating if no snapshot exists for it yet. Peer sessions never prompt for
 * a reflection.
 */
export function usePendingReflection<S extends PendingReflectionSession>(
  sessions: S[],
  sessionRatings: SessionGoalRating[],
  hasGoals: boolean
) {
  const pendingReflectionSession = useMemo(() => {
    const completed = sessions
      .filter((s) => s.status === "completed" && (s._source ?? "coaching") === "coaching")
      .sort((a, b) => +new Date(b.start_time) - +new Date(a.start_time));
    const ratedSessionIds = new Set(sessionRatings.map((r) => r.session_id));
    return completed.find((s) => !ratedSessionIds.has(s.id)) || null;
  }, [sessions, sessionRatings]);

  const needsRatingUpdate = hasGoals && !!pendingReflectionSession;

  return { pendingReflectionSession, needsRatingUpdate };
}
