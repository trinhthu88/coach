/**
 * Booking goal gate (spec Part 7) — client contract only.
 *
 * The rule lives in ONE place on the server (public.enrollment_goal_gate_state,
 * migration 20260925400000_booking_goal_gate.sql) and every booking RPC
 * enforces it through public.assert_enrollment_goal_gate. The client never
 * recomputes it: it reads public.enrollment_goal_gate() before submit and maps
 * the server's rejection to the same sentence when a stale screen submits.
 *
 * Day 1 = cohort start date (enrollment start date when the cohort has none);
 * days 1–7 are the grace period; from day 8 an enrollment without an active
 * goal cannot book Coaching, Peer Coaching, Mentoring or Triads.
 */

/** Stable machine-readable message of the server's booking rejection. */
export const GOAL_REQUIRED_BEFORE_BOOKING = "goal_required_before_booking";
/** Stable machine-readable message when the learner retires their last active goal after grace. */
export const LAST_ACTIVE_GOAL_REQUIRED = "last_active_goal_required";
/** Server-enforced maximum of active goals per enrollment (validate_enrollment_goal). */
export const MAX_ACTIVE_GOALS = 3;

export interface GoalGateState {
  enrollmentId: string;
  blocked: boolean;
  hasActiveGoal: boolean;
  activeGoalCount: number;
  maxActiveGoals: number;
  inGracePeriod: boolean;
  graceEndsOn: string | null;
  blockedFrom: string | null;
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** Parses the jsonb returned by public.enrollment_goal_gate(). */
export function parseGoalGate(raw: unknown): GoalGateState | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.enrollment_id !== "string" || typeof r.blocked !== "boolean") return null;
  return {
    enrollmentId: r.enrollment_id,
    blocked: r.blocked,
    hasActiveGoal: r.has_active_goal === true,
    activeGoalCount: typeof r.active_goal_count === "number" ? r.active_goal_count : 0,
    maxActiveGoals: typeof r.max_active_goals === "number" ? r.max_active_goals : MAX_ACTIVE_GOALS,
    inGracePeriod: r.in_grace_period === true,
    graceEndsOn: str(r.grace_ends_on),
    blockedFrom: str(r.blocked_from),
  };
}

function errorMentions(error: unknown, code: string): boolean {
  if (!error) return false;
  if (typeof error === "string") return error.includes(code);
  if (typeof error !== "object") return false;
  const e = error as { message?: unknown; details?: unknown };
  return [e.message, e.details].some((v) => typeof v === "string" && v.includes(code));
}

/** True when a booking was rejected by the server's goal gate. */
export function isGoalRequiredError(error: unknown): boolean {
  return errorMentions(error, GOAL_REQUIRED_BEFORE_BOOKING);
}

/** True when the server refused to retire the learner's last active goal. */
export function isKeepOneGoalError(error: unknown): boolean {
  return errorMentions(error, LAST_ACTIVE_GOAL_REQUIRED);
}

/** Mentoring pre-check reason (check_can_book_mentoring_session_reason_for_enrollment). */
export function isGoalRequiredReason(reason: unknown): boolean {
  return reason === GOAL_REQUIRED_BEFORE_BOOKING;
}
