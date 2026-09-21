import {
  deliverablePath,
  outstandingItems,
  type DeliverableKey,
  type SessionDeliverable,
} from "@/lib/postSessionDeliverables";

export interface PendingDeliverable {
  deliverable: SessionDeliverable;
  /** Required items still missing, in checklist order. */
  outstanding: DeliverableKey[];
  /** Where the learner completes them (Triads: the reflection page until it is written). */
  path: string;
}

/**
 * Completed sessions whose post-session deliverables are still outstanding.
 *
 * There is ONE definition of "outstanding": learner_session_deliverables()
 * (canonical_session_deliverable_state in the database) -- reflection, goal
 * check-in while an active goal exists, follow-up action and the learner's own
 * 1–5 rating, for every module and both Peer roles. This only filters and
 * orders those rows; it decides nothing itself, so My Journey, the module
 * pages and the session detail cannot disagree.
 */
export function derivePendingDeliverables(deliverables: SessionDeliverable[]): PendingDeliverable[] {
  return deliverables
    .filter((d) => !d.deliverablesComplete)
    .sort((a, b) => (b.startTime ?? "").localeCompare(a.startTime ?? ""))
    .map((deliverable) => ({
      deliverable,
      outstanding: outstandingItems(deliverable),
      path: deliverablePath(deliverable),
    }));
}
