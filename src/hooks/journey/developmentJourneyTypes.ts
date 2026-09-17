/**
 * One development-journey timeline item. This is a read-model shape only —
 * there is no persistence table for "journey events". Every event is
 * derived, at read time, from an existing canonical record (a goal, a
 * milestone, a goal check-in, an enrollment_action, a session of some kind,
 * a training completion, a reflection). `sourceType` + `sourceId` always
 * point back to that canonical row so nothing here is a second copy of the
 * fact — it is a formatted view of it.
 */
export type DevelopmentJourneyEventType =
  | "goal"
  | "action"
  | "coaching"
  | "peer_coaching"
  | "mentoring"
  | "triad"
  | "training"
  | "reflection"
  | "feedback";

export interface DevelopmentJourneyEvent {
  id: string;
  enrollmentId: string;
  occurredAt: string;
  type: DevelopmentJourneyEventType;
  subtype: string;
  title: string;
  summary?: string | null;
  status?: string | null;
  sourceId: string;
  sourceType: string;
  goalId?: string | null;
  milestoneId?: string | null;
}
