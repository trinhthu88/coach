import type { DevelopmentSessionItem } from "@/hooks/journey/developmentSessionTypes";

/**
 * Presentation helpers for canonical session history rows (ordering and
 * status tone only). Nothing here decides completion: `status` is the source
 * record's lifecycle status and programme evidence comes from the history
 * projection's is_programme_evidence flag.
 */
const DONE = new Set(["completed"]);
const MUTED = new Set(["cancelled", "no_show"]);

export function sessionStatusTone(status: string) {
  if (DONE.has(status)) return "bg-[#e8f1ec] text-[#17663f]";
  if (MUTED.has(status)) return "bg-[#f2eee6] text-[#7d7468]";
  return "bg-[#e4f1f5] text-[#226d80]";
}

/** Upcoming first (soonest first), then everything else newest first — ordering only, never filtering. */
export function orderSessionsForDisplay(sessions: DevelopmentSessionItem[]) {
  const time = (s: DevelopmentSessionItem) => (s.startTime ? new Date(s.startTime).getTime() : 0);
  const open = sessions.filter((s) => !DONE.has(s.status) && !MUTED.has(s.status)).sort((a, b) => time(a) - time(b));
  const rest = sessions.filter((s) => DONE.has(s.status) || MUTED.has(s.status)).sort((a, b) => time(b) - time(a));
  return [...open, ...rest];
}

/** The next booked (not completed/cancelled) session, if any. */
export function nextOpenSession(sessions: DevelopmentSessionItem[]) {
  return orderSessionsForDisplay(sessions).find((s) => !DONE.has(s.status) && !MUTED.has(s.status)) ?? null;
}

/**
 * The three stages a canonical session record can be in for a learner, from
 * its real lifecycle status. Ordering/grouping only -- nothing here decides
 * completion or evidence, which come from the history projection.
 *
 * A confirmed session whose start time has passed is deliberately NOT
 * "upcoming": it is waiting to be marked complete, which is a past-tense fact,
 * and showing it under "upcoming" is how a workspace ends up disagreeing with
 * the session itself.
 */
export function partitionSessionsByStage(sessions: DevelopmentSessionItem[], now = Date.now()) {
  const started = (s: DevelopmentSessionItem) => !s.startTime || new Date(s.startTime).getTime() <= now;
  const pending = sessions.filter((s) => s.status === "pending_coach_approval");
  const upcoming = sessions.filter((s) => s.status === "confirmed" && !started(s));
  const past = sessions.filter(
    (s) => s.status !== "pending_coach_approval" && !(s.status === "confirmed" && !started(s))
  );
  return {
    pending: orderSessionsForDisplay(pending),
    upcoming: orderSessionsForDisplay(upcoming),
    past: orderSessionsForDisplay(past),
  };
}
