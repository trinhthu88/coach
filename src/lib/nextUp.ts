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

function checkpointItem(point: LearnerJourneyPoint, kind: "overdue_requirement" | "current_requirement" | "upcoming_requirement"): NextUpItem {
  return { kind, label: point.label ?? `Checkpoint ${point.checkpoint_number}`, dueOn: point.due_on };
}

/**
 * Every currently-true "next up" candidate, in the same priority order
 * deriveNextUp picks its single winner from — tier 1 (overdue) before tier 2
 * (overdue actions) before tier 3 (current) before tier 4 (next session)
 * before tier 5 (upcoming). Unlike deriveNextUp, a tier does not exclude the
 * ones after it: a learner can genuinely have an overdue skill card AND an
 * upcoming session AND a Triad reflection due at once, and the approved
 * prototype's Next Up list shows exactly that — multiple real, simultaneous
 * items, not just the single highest-priority one. Within the overdue tiers,
 * every overdue learning item and every overdue action is a candidate (there
 * can genuinely be more than one); current/upcoming tiers stay singular,
 * matching deriveNextUp's own semantics for "the" current/next requirement.
 * No invented items — only ever what the same canonical sources already
 * return, capped at `limit`.
 */
export function deriveNextUpList({ journey, learningBreakdown, overdueActions, nextSessionAt }: NextUpInputs, limit = 3): NextUpItem[] {
  const items: NextUpItem[] = [];

  const overdueCheckpoint = journey.find((point) => point.state === "overdue");
  if (overdueCheckpoint) items.push(checkpointItem(overdueCheckpoint, "overdue_requirement"));
  for (const learningItem of learningBreakdown) {
    if (learningItem.status === "overdue") items.push({ kind: "overdue_requirement", label: learningItem.label, dueOn: null });
  }
  for (const action of overdueActions) {
    items.push({ kind: "overdue_action", label: action.title, dueOn: action.due_date });
  }

  const currentCheckpoint = journey.find((point) => point.state === "current");
  if (currentCheckpoint) items.push(checkpointItem(currentCheckpoint, "current_requirement"));
  else {
    const currentLearning = learningBreakdown.find((item) => item.status === "current");
    if (currentLearning) items.push({ kind: "current_requirement", label: currentLearning.label, dueOn: null });
  }

  if (nextSessionAt) items.push({ kind: "upcoming_session", label: "Coaching session", dueOn: nextSessionAt });

  const upcomingCheckpoint = journey.find((point) => point.state === "upcoming");
  if (upcomingCheckpoint) items.push(checkpointItem(upcomingCheckpoint, "upcoming_requirement"));

  return items.slice(0, limit);
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
 * "Nothing due right now" state rather than fabricating a step. The single
 * highest-priority item here is always deriveNextUpList(...)[0] — same
 * tiers, same ordering, just stopping at the first one instead of collecting
 * every current candidate.
 */
export function deriveNextUp(inputs: NextUpInputs): NextUpItem | null {
  return deriveNextUpList(inputs, 1)[0] ?? null;
}
