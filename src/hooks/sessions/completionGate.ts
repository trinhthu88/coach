/**
 * When the "mark session complete" action is available.
 *
 * Coaching (2026 redesign): marking a session complete records that the
 * CONVERSATION happened. The Coach is the actor, and the only preconditions
 * are that the session is confirmed and its start time has passed -- the same
 * rule complete_coaching_session() enforces server-side.
 *
 * It deliberately no longer depends on the learner's notes. Requiring
 * coachee_notes conflated two different facts: "the session took place" (a
 * Coach observation) and "the learner did their post-session work" (programme
 * evidence). The second is now the four-gate check in
 * coaching_session_evidence(), which decides whether the programme UNIT is
 * complete -- not whether the session was held.
 *
 * Peer sessions are unchanged: they have no Coach, so the participant's own
 * ICF competency feedback remains the precondition.
 */
export function canMarkSessionComplete(opts: {
  isPeer: boolean;
  peerFeedbackExisted: boolean;
  /** Coaching only: the session is confirmed. */
  isConfirmed?: boolean;
  /** Coaching only: start_time is in the past. */
  hasStarted?: boolean;
  /** Coaching only: the acting user is the assigned Coach (or an admin). */
  isCoachOrAdmin?: boolean;
}): boolean {
  if (opts.isPeer) return opts.peerFeedbackExisted;
  return !!opts.isConfirmed && !!opts.hasStarted && !!opts.isCoachOrAdmin;
}
