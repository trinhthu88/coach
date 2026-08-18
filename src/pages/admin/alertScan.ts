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

export interface ScanMentoringSessionRow {
  id: string;
  mentee_id: string;
  status: string;
  start_time: string;
  prep_file_path: string | null;
  feedback_submitted_at: string | null;
}

export interface MentoringAlert {
  severity: "warning" | "info";
  alert_type: "mentoring_prep_file" | "mentoring_feedback";
  title: string;
  message: string;
  related_coachee_id: string;
  resolved: false;
}

/**
 * Mentoring's equivalent of buildFeedbackAlerts above, for the two inputs
 * that gate mentoring_sessions specifically: the mentee's preparation file
 * (hard-gated at the DB level — see enforce_mentoring_prep_file_before_completion(),
 * 20260818140400_mentoring_sessions.sql) and the mentor's post-session
 * feedback (which can only be submitted once completed, so unlike the
 * reflection/competency-feedback alerts above there's no "confirmed and
 * blocking" case for it — it only ever shows up as an info-level reminder).
 */
export function buildMentoringPrepFileOverdueAlerts(opts: {
  mentoringSessions: ScanMentoringSessionRow[];
  nameById: Map<string, string | null | undefined>;
  emailById: Map<string, string | null | undefined>;
  now: Date;
}): MentoringAlert[] {
  const { mentoringSessions, nameById, emailById, now } = opts;
  const alerts: MentoringAlert[] = [];

  mentoringSessions.forEach((s) => {
    if (s.prep_file_path) return;
    if (!(s.status === "confirmed" && new Date(s.start_time) < now)) return;
    const name = nameById.get(s.mentee_id) || "Mentee";
    const dateStr = format(new Date(s.start_time), "d MMM yyyy");
    const email = emailById.get(s.mentee_id);
    const contact = email ? ` (${email})` : "";
    alerts.push({
      severity: "warning",
      alert_type: "mentoring_prep_file",
      title: `${name} — preparation file still missing`,
      message: `${name} hasn't submitted a preparation file for a mentoring session on ${dateStr}${contact}. The mentor can't mark this session complete until it's submitted.`,
      related_coachee_id: s.mentee_id,
      resolved: false,
    });
  });

  return alerts;
}

export function buildMentoringFeedbackOverdueAlerts(opts: {
  mentoringSessions: ScanMentoringSessionRow[];
  nameById: Map<string, string | null | undefined>;
  emailById: Map<string, string | null | undefined>;
}): MentoringAlert[] {
  const { mentoringSessions, nameById, emailById } = opts;
  const alerts: MentoringAlert[] = [];

  mentoringSessions.forEach((s) => {
    if (s.feedback_submitted_at) return;
    if (s.status !== "completed") return;
    const name = nameById.get(s.mentee_id) || "Mentee";
    const dateStr = format(new Date(s.start_time), "d MMM yyyy");
    const email = emailById.get(s.mentee_id);
    const contact = email ? ` (${email})` : "";
    alerts.push({
      severity: "info",
      alert_type: "mentoring_feedback",
      title: `${name} — mentor feedback missing (completed session)`,
      message: `The mentor hasn't submitted feedback for ${name}'s mentoring session on ${dateStr}${contact}.`,
      related_coachee_id: s.mentee_id,
      resolved: false,
    });
  });

  return alerts;
}
