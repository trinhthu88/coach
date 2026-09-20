/**
 * When the "mark session complete" action is available.
 *
 * Marking a session complete records that the CONVERSATION happened. It is an
 * operational fact about the meeting, so the only preconditions are that the
 * session is confirmed, its start time has passed, and the person acting was
 * entitled to be there -- exactly what the server-side writers enforce
 * (complete_coaching_session for Coaching, transition_peer_session_status for
 * both Peer tables).
 *
 * Coaching stopped depending on the learner's notes when the four-gate
 * coaching_session_evidence() took over deciding whether the programme UNIT is
 * complete. Peer now follows: it used to require the actor's own ICF
 * competency feedback, which conflated "the meeting took place" with "somebody
 * has written it up". A learner who genuinely met their peer could not say so
 * until the paperwork existed, and the unit stayed unfulfilled meanwhile.
 * Reflections, feedback, ratings, goals and actions remain valuable, are still
 * collected, and gate nothing.
 */
export function canMarkSessionComplete(opts: {
  /** The session is confirmed. */
  isConfirmed?: boolean;
  /** start_time is in the past. */
  hasStarted?: boolean;
  /**
   * Who may record it. Coaching: the assigned Coach or an Admin. Peer: either
   * participant or an Admin -- peer practice has no Coach to be the sole
   * authority, and both sides were in the room.
   */
  isPermittedActor?: boolean;
}): boolean {
  return !!opts.isConfirmed && !!opts.hasStarted && !!opts.isPermittedActor;
}
