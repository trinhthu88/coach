/**
 * Normalized session item for the learner's unified Sessions view. This is
 * a display projection only — status/date/enrollment scoping always come
 * straight from the canonical session tables (sessions, peer_sessions,
 * mentoring_sessions, triad_sessions); nothing here redefines completion or
 * booking business rules.
 */
export type DevelopmentSessionType = "coaching" | "peer_coaching" | "mentoring" | "triad";

export interface DevelopmentSessionItem {
  id: string;
  enrollmentId: string;
  type: DevelopmentSessionType;
  title: string;
  startTime: string | null;
  status: string;
  counterpartName?: string | null;
  sourceId: string;
  sourceType: string;
  roundLabel?: string | null;
  trainingWeekLabel?: string | null;
}
