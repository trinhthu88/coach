import { format } from "date-fns";

export interface ScanSessionRow {
  id: string;
  coachee_id: string;
  status: string;
  start_time: string;
  coachee_notes: string | null;
}

export interface ScanPeerSessionRow {
  id: string;
  peer_coachee_id: string;
  status: string;
  start_time: string;
}

export interface FeedbackAlert {
  severity: "warning" | "info";
  alert_type: "feedback_response";
  title: string;
  message: string;
  related_coachee_id: string;
  resolved: false;
}

/**
 * Detects coachees (and peer-coachees) who owe the input that gates
 * "Mark complete" on SessionDetail.tsx — a written reflection for regular
 * sessions, ICF competency feedback for peer sessions. Two situations are
 * raised: sessions actively blocked on it right now (warning), and sessions
 * already completed before the gate existed, still missing it (info).
 *
 * Extracted from AdminAlerts.tsx's runScan so the detection rules can be
 * unit tested without a live Supabase connection.
 */
export function buildFeedbackAlerts(opts: {
  sessions: ScanSessionRow[];
  peerSessions: ScanPeerSessionRow[];
  peerFeedbackSessionIds: Set<string>;
  nameById: Map<string, string | null | undefined>;
  emailById: Map<string, string | null | undefined>;
  now: Date;
}): FeedbackAlert[] {
  const { sessions, peerSessions, peerFeedbackSessionIds, nameById, emailById, now } = opts;
  const alerts: FeedbackAlert[] = [];

  const contactFor = (id: string) => {
    const email = emailById.get(id);
    return email ? ` (${email})` : "";
  };

  sessions.forEach((s) => {
    const hasReflection = !!(s.coachee_notes && s.coachee_notes.trim());
    if (hasReflection) return;
    const name = nameById.get(s.coachee_id) || "Coachee";
    const dateStr = format(new Date(s.start_time), "d MMM yyyy");
    const contact = contactFor(s.coachee_id);

    if (s.status === "confirmed" && new Date(s.start_time) < now) {
      alerts.push({
        severity: "warning",
        alert_type: "feedback_response",
        title: `${name} — reflection still missing`,
        message: `${name} hasn't submitted their reflection for a session on ${dateStr}${contact}. The coach can't mark this session complete until it's submitted.`,
        related_coachee_id: s.coachee_id,
        resolved: false,
      });
    } else if (s.status === "completed") {
      alerts.push({
        severity: "info",
        alert_type: "feedback_response",
        title: `${name} — reflection missing (completed session)`,
        message: `${name} hasn't submitted their reflection for a session on ${dateStr}${contact}.`,
        related_coachee_id: s.coachee_id,
        resolved: false,
      });
    }
  });

  peerSessions.forEach((s) => {
    if (peerFeedbackSessionIds.has(s.id)) return;
    const name = nameById.get(s.peer_coachee_id) || "Coachee";
    const dateStr = format(new Date(s.start_time), "d MMM yyyy");
    const contact = contactFor(s.peer_coachee_id);

    if (s.status === "confirmed" && new Date(s.start_time) < now) {
      alerts.push({
        severity: "warning",
        alert_type: "feedback_response",
        title: `${name} — competency feedback still missing`,
        message: `${name} hasn't submitted their competency feedback for a peer session on ${dateStr}${contact}. The coach can't mark this session complete until it's submitted.`,
        related_coachee_id: s.peer_coachee_id,
        resolved: false,
      });
    } else if (s.status === "completed") {
      alerts.push({
        severity: "info",
        alert_type: "feedback_response",
        title: `${name} — competency feedback missing (completed session)`,
        message: `${name} hasn't submitted their competency feedback for a peer session on ${dateStr}${contact}.`,
        related_coachee_id: s.peer_coachee_id,
        resolved: false,
      });
    }
  });

  return alerts;
}
