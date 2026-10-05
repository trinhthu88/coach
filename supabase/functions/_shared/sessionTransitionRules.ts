// Pure rules behind the confirm-session and cancel-session edge functions.
//
// The database owns every session status change: these functions only decide
// which lifecycle RPC to call AS THE CALLER, refuse a transition that cannot
// happen before any side effect (a Zoom meeting, an email), and map Postgres
// error codes to HTTP statuses. It has NO runtime imports so it runs unchanged
// in Deno and in Vitest (src/lib/__tests__/sessionTransitionRules.test.ts).

export type SessionAction = "confirm" | "cancel";

export type TransitionDecision =
  | { kind: "proceed" }
  | { kind: "already_confirmed" }
  | { kind: "refuse"; httpStatus: number; error: string };

const FINAL_STATUSES = ["cancelled", "completed", "rescheduled"];

/**
 * What to do with a confirm / cancel request for a session in `status`.
 * Cancelled, completed and rescheduled sessions are final for both actions.
 */
export function decideTransition(action: SessionAction, status: string): TransitionDecision {
  if (FINAL_STATUSES.includes(status)) {
    return {
      kind: "refuse",
      httpStatus: 409,
      error: `A ${status} session cannot be ${action === "confirm" ? "confirmed" : "cancelled"}`,
    };
  }
  if (action === "confirm" && status === "confirmed") return { kind: "already_confirmed" };
  if (action === "confirm" && status !== "pending_coach_approval") {
    return { kind: "refuse", httpStatus: 409, error: `A ${status} session cannot be confirmed` };
  }
  return { kind: "proceed" };
}

/** The lifecycle RPC (and its arguments) that performs `action`. */
export function transitionRpc(
  action: SessionAction,
  isPeer: boolean,
  sessionId: string,
  opts: { meetingUrl?: string | null; reason?: string | null } = {},
): { fn: string; args: Record<string, unknown> } {
  if (action === "confirm") {
    return isPeer
      ? { fn: "confirm_peer_session", args: { p_session_id: sessionId, p_meeting_url: opts.meetingUrl ?? null } }
      : { fn: "confirm_coaching_session", args: { p_session_id: sessionId, p_meeting_url: opts.meetingUrl ?? null } };
  }
  return isPeer
    ? {
        fn: "transition_peer_session_status",
        args: { p_session_kind: "peer", p_session_id: sessionId, p_status: "cancelled", p_reason: opts.reason || null },
      }
    : { fn: "cancel_coaching_session", args: { p_session_id: sessionId, p_reason: opts.reason || null } };
}

/** HTTP status for an error raised by a lifecycle RPC. */
export function httpStatusForRpcError(code: string | undefined | null): number {
  switch (code) {
    case "42501": return 403; // not authorised
    case "23503": return 404; // no such session
    case "23514":             // transition not permitted from this status
    case "23505": return 409; // conflict
    default: return 400;
  }
}
