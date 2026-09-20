export type SessionStatus =
  | "pending_coach_approval"
  | "confirmed"
  | "completed"
  | "cancelled"
  | "rescheduled";

export type SessionKind = "coaching" | "peer" | "coachee_peer";
export type SessionAction = "confirm" | "cancel" | "complete";

const LIVE_STATUSES = new Set<SessionStatus>(["pending_coach_approval", "confirmed"]);

export function canTransitionSession(
  status: SessionStatus,
  action: SessionAction,
  // Accepted and ignored: callers still pass the session clock, but lateness
  // is the server's decision (see the cancel branch below).
  _opts?: { now?: string; startTime?: string },
): boolean {
  if (action === "confirm") return status === "pending_coach_approval";
  if (action === "complete") return status === "confirmed";
  // A live session can be cancelled. How late is too late is the server's
  // question, not this function's: cancel_coaching_session() permits a Coach
  // or Admin at any time, and a learner inside 24 hours with a reason.
  return action === "cancel" && LIVE_STATUSES.has(status);
}

/**
 * Peer sessions only.
 *
 * The Coaching branch was removed in the 2026-09 canonical remediation: it
 * gated completion on the learner's notes, which conflated "the meeting
 * happened" with "the learner wrote it up". Coaching completion is
 * complete_coaching_session() plus canMarkSessionComplete(); the write-up is
 * after-session evidence and gates nothing.
 */
export function canCompletePeerSession(opts: {
  peerFeedbackExists?: boolean;
}): boolean {
  return opts.peerFeedbackExists === true;
}

export function getAllowedSessionPatch(
  actor: "coach" | "coachee" | "admin",
  patch: Record<string, unknown>,
): Record<string, unknown> {
  if (actor === "admin") return { ...patch };
  const allowed = actor === "coach" ? ["coach_notes", "meeting_url"] : ["coachee_notes"];
  return Object.fromEntries(Object.entries(patch).filter(([key]) => allowed.includes(key)));
}