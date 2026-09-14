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
  opts?: { now?: string; startTime?: string },
): boolean {
  if (action === "confirm") return status === "pending_coach_approval";
  if (action === "complete") return status === "confirmed";
  if (action !== "cancel" || !LIVE_STATUSES.has(status)) return false;

  if (!opts?.now || !opts.startTime) return true;
  const cutoff = new Date(opts.startTime).getTime() - 24 * 60 * 60 * 1000;
  return new Date(opts.now).getTime() <= cutoff;
}

export function canCompleteSession(opts: {
  kind: SessionKind;
  coacheeNotes?: string | null;
  peerFeedbackExists?: boolean;
}): boolean {
  if (opts.kind === "coaching") return Boolean(opts.coacheeNotes?.trim());
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