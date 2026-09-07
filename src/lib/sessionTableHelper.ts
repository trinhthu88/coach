export type SessionTableKind = "sessions" | "peer_sessions" | "coachee_peer_sessions";

interface SessionFieldMap {
  table: SessionTableKind;
  coachField: string;
  coacheeField: string;
  coachNotesField: string;
  coacheeNotesField: string;
}

/**
 * Coach/coachee column names differ per session table (peer_coach_id/peer_coachee_id,
 * peer_provider_id/peer_receiver_id, provider_notes/receiver_notes) — this centralizes
 * that mapping so callers don't reimplement the isPeer/isCoacheePeer branching inline.
 */
export function getSessionFieldMap(isPeer: boolean, isCoacheePeer?: boolean): SessionFieldMap {
  if (isCoacheePeer) {
    return {
      table: "coachee_peer_sessions",
      coachField: "peer_provider_id",
      coacheeField: "peer_receiver_id",
      coachNotesField: "provider_notes",
      coacheeNotesField: "receiver_notes",
    };
  }
  if (isPeer) {
    return {
      table: "peer_sessions",
      coachField: "peer_coach_id",
      coacheeField: "peer_coachee_id",
      coachNotesField: "coach_notes",
      coacheeNotesField: "coachee_notes",
    };
  }
  return {
    table: "sessions",
    coachField: "coach_id",
    coacheeField: "coachee_id",
    coachNotesField: "coach_notes",
    coacheeNotesField: "coachee_notes",
  };
}
