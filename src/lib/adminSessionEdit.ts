/**
 * The Admin session edit dialog, as a plan of lifecycle calls.
 *
 * An Admin never writes a session row: every change is a SECURITY DEFINER
 * function (20261005110000_admin_session_edits) or the cancel-session edge
 * function, which calls one as the Admin. This module turns "what the dialog
 * started with" and "what the Admin chose" into those calls, in order.
 *
 *   live -> live, details changed      admin_reschedule_session (reason)
 *   pending -> confirmed               [reschedule first if details changed] + confirm
 *   confirmed -> completed             complete_coaching_session / Peer completion
 *   live -> cancelled                  cancel-session (optional cancellation reason)
 *   cancelled -> pending (reopen)      admin_reopen_session (reason, optional new time)
 *                                      [+ reschedule for a new topic / link]
 *   completed -> confirmed (reopen)    admin_reopen_session (reason); details locked
 */

export type AdminSessionKind = "coaching" | "peer";

export interface AdminSessionSnapshot {
  id: string;
  kind: AdminSessionKind;
  status: string;
  topic: string;
  start_time: string;
  duration_minutes: number;
  meeting_url: string | null;
}

export type AdminSessionStep =
  | { type: "rpc"; fn: string; args: Record<string, unknown> }
  | { type: "cancel"; body: { session_id: string; is_peer: boolean; reason?: string } };

export type AdminSessionPlan =
  | { ok: true; steps: AdminSessionStep[] }
  | { ok: false; error: "reasonRequired" | "detailsLocked" };

const LIVE = ["pending_coach_approval", "confirmed"];

/** The statuses an Admin may choose from, given the session's current status. */
export function adminStatusOptions(status: string): string[] {
  switch (status) {
    case "pending_coach_approval": return ["pending_coach_approval", "confirmed", "cancelled"];
    case "confirmed": return ["confirmed", "completed", "cancelled"];
    case "cancelled": return ["cancelled", "pending_coach_approval"];
    case "completed": return ["completed", "confirmed"];
    default: return [status];
  }
}

/** Whether a choice of status reopens the session. */
export function isReopen(originalStatus: string, targetStatus: string): boolean {
  return (originalStatus === "cancelled" && targetStatus === "pending_coach_approval")
    || (originalStatus === "completed" && targetStatus === "confirmed");
}

/**
 * Time, duration, topic and link are editable only while the session stays
 * (or becomes) a live request at a future-capable time: never together with a
 * cancellation or completion, and never on a completed session.
 */
export function adminDetailsEditable(originalStatus: string, targetStatus: string): boolean {
  if (originalStatus === "completed") return false;
  return LIVE.includes(targetStatus);
}

function sameInstant(a: string, b: string): boolean {
  return new Date(a).getTime() === new Date(b).getTime();
}

export function planAdminSessionSave(
  original: AdminSessionSnapshot,
  edited: AdminSessionSnapshot,
  opts: { reason: string; cancelReason?: string },
): AdminSessionPlan {
  const reason = opts.reason.trim();
  const isPeer = original.kind === "peer";
  const timeChanged = !sameInstant(original.start_time, edited.start_time)
    || original.duration_minutes !== edited.duration_minutes;
  const otherDetailsChanged = original.topic !== edited.topic
    || (original.meeting_url ?? "") !== (edited.meeting_url ?? "");
  const detailsChanged = timeChanged || otherDetailsChanged;

  if (detailsChanged && !adminDetailsEditable(original.status, edited.status)) {
    return { ok: false, error: "detailsLocked" };
  }

  const reschedule = (): AdminSessionStep => ({
    type: "rpc",
    fn: "admin_reschedule_session",
    args: {
      p_kind: original.kind,
      p_session_id: original.id,
      p_start_time: edited.start_time,
      p_duration_minutes: edited.duration_minutes,
      p_reason: reason,
      p_topic: edited.topic,
      p_meeting_url: edited.meeting_url ?? "",
    },
  });

  const steps: AdminSessionStep[] = [];
  const from = original.status;
  const to = edited.status;

  if (isReopen(from, to)) {
    steps.push({
      type: "rpc",
      fn: "admin_reopen_session",
      args: {
        p_kind: original.kind,
        p_session_id: original.id,
        p_reason: reason,
        p_start_time: timeChanged ? edited.start_time : null,
        p_duration_minutes: timeChanged ? edited.duration_minutes : null,
      },
    });
    if (otherDetailsChanged) steps.push(reschedule());
  } else if (to === from) {
    if (detailsChanged) steps.push(reschedule());
  } else if (to === "cancelled") {
    steps.push({
      type: "cancel",
      body: { session_id: original.id, is_peer: isPeer, reason: opts.cancelReason?.trim() || undefined },
    });
  } else if (to === "completed") {
    steps.push(isPeer
      ? { type: "rpc", fn: "transition_peer_session_status",
          args: { p_session_kind: "peer", p_session_id: original.id, p_status: "completed", p_reason: null } }
      : { type: "rpc", fn: "complete_coaching_session", args: { p_session_id: original.id } });
  } else if (from === "pending_coach_approval" && to === "confirmed") {
    if (detailsChanged) steps.push(reschedule());
    steps.push({
      type: "rpc",
      fn: isPeer ? "confirm_peer_session" : "confirm_coaching_session",
      args: { p_session_id: original.id, p_meeting_url: null },
    });
  }

  const needsReason = steps.some((s) => s.type === "rpc"
    && (s.fn === "admin_reopen_session" || s.fn === "admin_reschedule_session"));
  if (needsReason && !reason) return { ok: false, error: "reasonRequired" };
  return { ok: true, steps };
}

/** True when the dialog's choices need a reason before saving. */
export function adminSessionNeedsReason(original: AdminSessionSnapshot, edited: AdminSessionSnapshot): boolean {
  const plan = planAdminSessionSave(original, edited, { reason: "" });
  return !plan.ok && plan.error === "reasonRequired";
}
