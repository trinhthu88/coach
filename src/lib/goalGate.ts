/**
 * Booking goal gate — client contract only.
 *
 * The rule lives in ONE place on the server: public.check_booking_eligibility
 * (at least one active goal on the enrollment), evaluated by
 * enrollment_goal_gate_state and enforced by every booking RPC through
 * assert_enrollment_goal_gate (20260926600000). The client never recomputes
 * it: it reads public.enrollment_goal_gate() before submit and maps the
 * server's rejection ("Create at least one goal first") to the same sentence
 * when a stale screen submits.
 *
 * No active goal = no booking of Coaching, Peer Coaching, Mentoring or Triads,
 * from day 1. Separately, cohort start + 7 days is the goal setup deadline:
 * after it, goalSetupOverdue is an ALERT for the Learner and Admin — it never
 * changes the booking rule.
 */

/** Stable machine-readable code of the server's booking rejection (error detail / gate reason). */
export const GOAL_REQUIRED_BEFORE_BOOKING = "goal_required_before_booking";
/** The server's booking rejection message. */
export const GOAL_REQUIRED_MESSAGE = "Create at least one goal first";
/** Stable machine-readable message when the learner retires their last active goal after the goal setup deadline. */
export const LAST_ACTIVE_GOAL_REQUIRED = "last_active_goal_required";
/** Server-enforced maximum of active goals per enrollment (validate_enrollment_goal). */
export const MAX_ACTIVE_GOALS = 3;

export interface GoalGateState {
  enrollmentId: string;
  blocked: boolean;
  hasActiveGoal: boolean;
  activeGoalCount: number;
  maxActiveGoals: number;
  /** Cohort start + 7 days. */
  goalSetupDeadline: string | null;
  /** Past the goal setup deadline with no active goal — an alert, not a booking rule. */
  goalSetupOverdue: boolean;
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
    goalSetupDeadline: str(r.goal_setup_deadline),
    goalSetupOverdue: r.goal_setup_overdue === true,
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
  return errorMentions(error, GOAL_REQUIRED_BEFORE_BOOKING) || errorMentions(error, GOAL_REQUIRED_MESSAGE);
}

/** True when the server refused to retire the learner's last active goal. */
export function isKeepOneGoalError(error: unknown): boolean {
  return errorMentions(error, LAST_ACTIVE_GOAL_REQUIRED);
}

/** Mentoring pre-check reason (check_can_book_mentoring_session_reason_for_enrollment). */
export function isGoalRequiredReason(reason: unknown): boolean {
  return reason === GOAL_REQUIRED_BEFORE_BOOKING;
}
