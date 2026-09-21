import type { EnrollmentActionSource } from "@/lib/enrollmentActions";
import { sessionDetailPathFor } from "@/lib/sessionPaths";

/**
 * Post-session deliverables — the client half of
 * supabase/migrations/20260925500000_post_session_deliverables.sql.
 *
 * The four shared stores spell the modules differently (reflections say
 * "triads", goal check-ins and actions say "triad"; actions key
 * learner-to-learner peer as "coachee_peer_coaching"). This table is the
 * client mirror of session_deliverable_source_types() and is the ONLY place
 * a writer should look the spelling up.
 */
export type SessionSourceTable =
  | "sessions"
  | "peer_sessions"
  | "coachee_peer_sessions"
  | "mentoring_sessions"
  | "triad_sessions";

export type DeliverableModule = "coaching" | "peer_coaching" | "mentoring" | "triads";
export type ReflectionSourceType = "coaching" | "peer_coaching" | "mentoring" | "triads";
export type CheckinSourceType = "coaching" | "peer_coaching" | "mentoring" | "triad";

export const DELIVERABLE_SOURCE_TYPES: Record<
  SessionSourceTable,
  { module: DeliverableModule; reflection: ReflectionSourceType; checkin: CheckinSourceType; action: EnrollmentActionSource }
> = {
  sessions: { module: "coaching", reflection: "coaching", checkin: "coaching", action: "coaching" },
  peer_sessions: { module: "peer_coaching", reflection: "peer_coaching", checkin: "peer_coaching", action: "peer_coaching" },
  coachee_peer_sessions: { module: "peer_coaching", reflection: "peer_coaching", checkin: "peer_coaching", action: "coachee_peer_coaching" },
  mentoring_sessions: { module: "mentoring", reflection: "mentoring", checkin: "mentoring", action: "mentoring" },
  triad_sessions: { module: "triads", reflection: "triads", checkin: "triad", action: "triad" },
};

export type DeliverableKey = "reflection" | "goalCheckin" | "action" | "satisfaction";

/** One participating enrollment's deliverables for one session (canonical row). */
export interface SessionDeliverable {
  module: DeliverableModule;
  sourceTable: SessionSourceTable;
  sessionId: string;
  participantRole: string | null;
  title: string | null;
  startTime: string | null;
  counterpartNames: string[];
  requirementUnitNumber: number | null;
  hasReflection: boolean;
  hasGoalCheckin: boolean;
  goalCheckinRequired: boolean;
  hasAction: boolean;
  hasSatisfaction: boolean;
  satisfactionRating: number | null;
  deliverablesComplete: boolean;
}

export interface DeliverableItem {
  key: DeliverableKey;
  done: boolean;
  required: boolean;
}

/** The base checklist every module shares, in display order. */
export function deliverableItems(d: Pick<SessionDeliverable, "hasReflection" | "hasGoalCheckin" | "goalCheckinRequired" | "hasAction" | "hasSatisfaction">): DeliverableItem[] {
  return [
    { key: "reflection", done: d.hasReflection, required: true },
    // Only while the enrollment holds an active goal; otherwise it is shown as
    // not required rather than as something the learner cannot do.
    { key: "goalCheckin", done: d.hasGoalCheckin, required: d.goalCheckinRequired },
    { key: "action", done: d.hasAction, required: true },
    { key: "satisfaction", done: d.hasSatisfaction, required: true },
  ];
}

/** Required items still missing. Empty exactly when deliverables_complete. */
export function outstandingItems(d: SessionDeliverable): DeliverableKey[] {
  return deliverableItems(d).filter((i) => i.required && !i.done).map((i) => i.key);
}

/** Where the learner completes a session's deliverables (Triads: the role-based reflection page). */
export function deliverablePath(d: Pick<SessionDeliverable, "sourceTable" | "sessionId" | "hasReflection">): string {
  if (d.sourceTable === "triad_sessions" && !d.hasReflection) return `/triads/${d.sessionId}/reflect`;
  return sessionDetailPathFor(d.sourceTable, d.sessionId) ?? "/sessions";
}

const DEV_TYPE_BY_MODULE: Record<DeliverableModule, "coaching" | "peer_coaching" | "mentoring" | "triad"> = {
  coaching: "coaching",
  peer_coaching: "peer_coaching",
  mentoring: "mentoring",
  triads: "triad",
};

/** The development-session type (learner_session_history.session_type) of a deliverable's module. */
export function deliverableSessionType(module: DeliverableModule) {
  return DEV_TYPE_BY_MODULE[module];
}

/** A stable key joining a deliverable to a learner_session_history row. */
export function deliverableKey(sourceTable: string, sessionId: string) {
  return `${sourceTable}:${sessionId}`;
}

export function toSessionDeliverable(r: {
  module: string;
  source_table: string;
  session_id: string;
  participant_role?: string | null;
  title?: string | null;
  start_time?: string | null;
  counterpart_names?: string[] | null;
  requirement_unit_number?: number | null;
  has_reflection: boolean | null;
  has_goal_checkin: boolean | null;
  goal_checkin_required: boolean | null;
  has_action: boolean | null;
  has_satisfaction: boolean | null;
  satisfaction_rating: number | null;
  deliverables_complete: boolean | null;
}): SessionDeliverable {
  return {
    module: r.module as DeliverableModule,
    sourceTable: r.source_table as SessionSourceTable,
    sessionId: r.session_id,
    participantRole: r.participant_role ?? null,
    title: r.title ?? null,
    startTime: r.start_time ?? null,
    counterpartNames: r.counterpart_names ?? [],
    requirementUnitNumber: r.requirement_unit_number ?? null,
    hasReflection: !!r.has_reflection,
    hasGoalCheckin: !!r.has_goal_checkin,
    goalCheckinRequired: !!r.goal_checkin_required,
    hasAction: !!r.has_action,
    hasSatisfaction: !!r.has_satisfaction,
    satisfactionRating: r.satisfaction_rating ?? null,
    deliverablesComplete: !!r.deliverables_complete,
  };
}
