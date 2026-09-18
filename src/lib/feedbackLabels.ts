import type { LearnerFeedbackItem } from "@/hooks/dashboard/useLearnerFeedback";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** i18n key suffix for a feedback item's source — one mapping for every surface. */
export function feedbackSourceKey(item: LearnerFeedbackItem): "mentoring" | "peer_competency" | "coaching_note" | "mentoring_note" | "peer_practice_note" {
  if (item.kind !== "session_note") return item.kind;
  if (item.source === "coaching") return "coaching_note";
  if (item.source === "mentoring") return "mentoring_note";
  return "peer_practice_note";
}

/** "Mentor feedback · Morgan", "Coach session note · Alex", … (`dashboard` namespace). */
export function feedbackAuthorLabel(item: LearnerFeedbackItem, t: Translate): string {
  return t(`learnerProfile.feedback.from.${feedbackSourceKey(item)}`, {
    name: item.fromName ?? t("cards.myFeedback.someone"),
  });
}

/** Short type chip ("Mentor feedback", "Coach note", …) (`dashboard` namespace). */
export function feedbackTypeLabel(item: LearnerFeedbackItem, t: Translate): string {
  return t(`learnerProfile.feedback.types.${feedbackSourceKey(item)}`);
}

/** The written text of any learner-visible feedback item (null when it carries only scores). */
export function feedbackText(item: LearnerFeedbackItem): string | null {
  if (item.kind === "mentoring") return item.overallNotes;
  return item.note;
}

/** Programme module a feedback item belongs to. */
export function feedbackModule(item: LearnerFeedbackItem): "coaching" | "mentoring" | "peer_coaching" {
  if (item.kind === "mentoring") return "mentoring";
  if (item.kind === "session_note") return item.source === "peer_practice" ? "peer_coaching" : item.source;
  return "peer_coaching";
}

/** Where the learner can open the source of a feedback item. */
export function feedbackSourcePath(item: LearnerFeedbackItem): string | null {
  if (item.kind !== "session_note") return null;
  if (item.source === "coaching") return `/sessions/${item.sessionId}`;
  if (item.source === "mentoring") return `/mentoring/sessions/${item.sessionId}`;
  return `/sessions/${item.sessionId}?type=coachee_peer`;
}
