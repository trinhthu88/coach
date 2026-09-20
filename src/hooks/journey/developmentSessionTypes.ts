/**
 * Normalized session item for the learner's unified Sessions view. This is
 * a display projection of learner_session_history — status/date/enrollment
 * scoping come straight from the canonical session tables (sessions,
 * coachee_peer_sessions / peer_sessions, mentoring_sessions, triad_sessions)
 * and `isProgrammeEvidence` straight from canonical requirement fulfilment
 * (raw attribution only for the modules that have no requirement link);
 * nothing here redefines completion or booking business rules.
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
  /** Source table: sessions | peer_sessions | coachee_peer_sessions | mentoring_sessions | triad_sessions. */
  sourceType: string;
  /** The learner's role in the session (coachee, receiver, provider, mentee, coach, observer). */
  participantRole?: string | null;
  /** Completed AND holding one of this enrollment's cohort requirements — i.e. counted by canonical module progress. */
  isProgrammeEvidence?: boolean;
  counterpartNames?: string[];
  /** Triad sessions: the requirement of the session's group ("Triad N"). */
  requirementUnitNumber?: number | null;
}
