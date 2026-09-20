import type { DevelopmentSessionItem } from "@/hooks/journey/developmentSessionTypes";
import type { SessionKind } from "@/hooks/sessions/useSessionsData";

/**
 * The single session-detail route resolver, keyed on the record's SOURCE
 * TABLE (never on the module alone): coach-to-coach peer sessions and
 * coachee-to-coachee peer practice are both "peer coaching" but live in
 * different tables, and SessionDetail picks its table from `?type=`.
 * Routing a coachee_peer_sessions row to `?type=peer` looked it up in
 * peer_sessions and showed "session unavailable".
 */
export function sessionDetailPathFor(sourceTable: string, sourceId: string): string | null {
  switch (sourceTable) {
    case "sessions":
      return `/sessions/${sourceId}`;
    case "peer_sessions":
      return `/sessions/${sourceId}?type=peer`;
    case "coachee_peer_sessions":
      return `/sessions/${sourceId}?type=coachee_peer`;
    case "mentoring_sessions":
      return `/mentoring/sessions/${sourceId}`;
    case "triad_sessions":
      return `/triads/${sourceId}`;
    default:
      return null;
  }
}

/** Detail route for a unified development-session row (My Journey, Dashboard, Peer/Mentor/Coach sections). */
export function sessionDetailPath(item: DevelopmentSessionItem): string | null {
  return sessionDetailPathFor(item.sourceType, item.sourceId);
}

const SOURCE_TABLE_BY_KIND: Record<SessionKind, string> = {
  coaching: "sessions",
  "peer-give": "peer_sessions",
  "peer-receive": "peer_sessions",
  "coachee-peer-give": "coachee_peer_sessions",
  "coachee-peer-receive": "coachee_peer_sessions",
  "mentoring-mentor": "mentoring_sessions",
  "mentoring-mentee": "mentoring_sessions",
  triad: "triad_sessions",
};

/** Detail route for a Your Sessions row (useSessionsData) — same resolver, keyed on the row's source table. */
export function sessionRowDetailPath(row: { id: string; kind: SessionKind }): string {
  return sessionDetailPathFor(SOURCE_TABLE_BY_KIND[row.kind], row.id) ?? "/sessions";
}
