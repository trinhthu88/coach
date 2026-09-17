import type { LearnerJourneyPoint, LearnerLearningItem } from "@/hooks/useLearnerCanonicalProgress";
import type { EnrollmentActionRow } from "@/hooks/dashboard/useEnrollmentActionsSummary";

export type NextUpKind = "overdue_requirement" | "overdue_action" | "current_requirement" | "upcoming_session" | "upcoming_requirement";

export interface NextUpItem {
  kind: NextUpKind;
  label: string;
  dueOn: string | null;
}

interface NextUpInputs {
  journey: LearnerJourneyPoint[];
  learningBreakdown: LearnerLearningItem[];
  overdueActions: EnrollmentActionRow[];
  nextSessionAt: string | null;
}

/**
 * Deterministic "what should I do next" derivation — no invented steps, only
 * a priority ordering over data every source already returns:
 *   1. overdue required programme activity (journey checkpoint, else a
 *      specific overdue learning item)
 *   2. an open action already past its due date
 *   3. the current (in-progress, not-yet-due) requirement
 *   4. the next booked coaching session
 *   5. the next future (not-yet-due) requirement
 * Returns null when none of these exist — the caller renders an explicit
 * "Nothing due right now" state rather than fabricating a step.
 */
export function deriveNextUp({ journey, learningBreakdown, overdueActions, nextSessionAt }: NextUpInputs): NextUpItem | null {
  const overdueCheckpoint = journey.find((point) => point.state === "overdue");
  if (overdueCheckpoint) {
    return { kind: "overdue_requirement", label: overdueCheckpoint.label ?? `Checkpoint ${overdueCheckpoint.checkpoint_number}`, dueOn: overdueCheckpoint.due_on };
  }
  const overdueLearning = learningBreakdown.find((item) => item.status === "overdue");
  if (overdueLearning) {
    return { kind: "overdue_requirement", label: overdueLearning.label, dueOn: null };
  }

  if (overdueActions.length > 0) {
    const next = overdueActions[0];
    return { kind: "overdue_action", label: next.title, dueOn: next.due_date };
  }

  const currentCheckpoint = journey.find((point) => point.state === "current");
  if (currentCheckpoint) {
    return { kind: "current_requirement", label: currentCheckpoint.label ?? `Checkpoint ${currentCheckpoint.checkpoint_number}`, dueOn: currentCheckpoint.due_on };
  }
  const currentLearning = learningBreakdown.find((item) => item.status === "current");
  if (currentLearning) {
    return { kind: "current_requirement", label: currentLearning.label, dueOn: null };
  }

  if (nextSessionAt) {
    return { kind: "upcoming_session", label: "Coaching session", dueOn: nextSessionAt };
  }

  const upcomingCheckpoint = journey.find((point) => point.state === "upcoming");
  if (upcomingCheckpoint) {
    return { kind: "upcoming_requirement", label: upcomingCheckpoint.label ?? `Checkpoint ${upcomingCheckpoint.checkpoint_number}`, dueOn: upcomingCheckpoint.due_on };
  }

  return null;
}
