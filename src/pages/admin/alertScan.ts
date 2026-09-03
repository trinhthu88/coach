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

// ---------------------------------------------------------------------
// Phase 4 (L&D dashboards), part C: three programme-related alert types
// for AdminAlerts.tsx's manual "Run scan" button — distinct from, and a
// faster-turnaround complement to, the daily send-programme-reminders
// Edge Function (Phase 3), which raises its own 'stale_participant' alerts
// on a fixed schedule the admin can't trigger on demand.
// ---------------------------------------------------------------------

export interface ProgrammeAlert {
  severity: "info" | "warning" | "critical";
  alert_type: "stale_programme_participant" | "low_quiz_scores" | "triad_not_scheduled";
  title: string;
  message: string;
  related_coachee_id: string | null;
  resolved: false;
}

export interface ScanActivityRow {
  userId: string;
  timestamp: string | null;
}

/**
 * Active enrollees with no recorded activity (training completion, quiz/
 * reflection submission, triad reflection, or daily prompt response) in the
 * last 7 days, or ever. Each activity kind is passed pre-flattened to
 * (userId, timestamp) pairs so this stays agnostic of which table each
 * signal came from.
 */
export function buildStaleProgrammeParticipantAlerts(opts: {
  activeUserIds: string[];
  activity: ScanActivityRow[];
  nameById: Map<string, string | null | undefined>;
  emailById: Map<string, string | null | undefined>;
  now: Date;
}): ProgrammeAlert[] {
  const { activeUserIds, activity, nameById, emailById, now } = opts;
  const lastActiveByUser = new Map<string, number>();
  activity.forEach(({ userId, timestamp }) => {
    if (!timestamp) return;
    const t = new Date(timestamp).getTime();
    if (!lastActiveByUser.has(userId) || t > (lastActiveByUser.get(userId) ?? 0)) lastActiveByUser.set(userId, t);
  });

  const cutoff = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  return activeUserIds
    .filter((id) => !lastActiveByUser.has(id) || (lastActiveByUser.get(id) ?? 0) < cutoff)
    .map((id) => {
      const name = nameById.get(id) || "Participant";
      const email = emailById.get(id);
      const contact = email ? ` (${email})` : "";
      const lastActive = lastActiveByUser.get(id);
      const sinceText = lastActive
        ? `last activity ${format(new Date(lastActive), "d MMM yyyy")}`
        : "no activity recorded since enrolling";
      return {
        severity: "warning" as const,
        alert_type: "stale_programme_participant" as const,
        title: `${name} — no programme activity in 7+ days`,
        message: `${name}${contact} hasn't completed a training week, quiz, triad reflection, or daily prompt in over a week (${sinceText}).`,
        related_coachee_id: id,
        resolved: false,
      };
    });
}

export interface ScanQuizSubmissionRow {
  userId: string;
  scorePct: number | null;
}

/** Enrolled participants whose average quiz score sits below 50%. */
export function buildLowQuizScoreAlerts(opts: {
  submissions: ScanQuizSubmissionRow[];
  nameById: Map<string, string | null | undefined>;
  emailById: Map<string, string | null | undefined>;
}): ProgrammeAlert[] {
  const { submissions, nameById, emailById } = opts;
  const byUser = new Map<string, number[]>();
  submissions.forEach(({ userId, scorePct }) => {
    if (scorePct == null) return;
    const arr = byUser.get(userId) ?? [];
    arr.push(scorePct);
    byUser.set(userId, arr);
  });

  const alerts: ProgrammeAlert[] = [];
  byUser.forEach((scores, userId) => {
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    if (avg >= 50) return;
    const name = nameById.get(userId) || "Participant";
    const email = emailById.get(userId);
    const contact = email ? ` (${email})` : "";
    alerts.push({
      severity: "warning",
      alert_type: "low_quiz_scores",
      title: `${name} — quiz average ${Math.round(avg)}%`,
      message: `${name}${contact} is averaging ${Math.round(avg)}% across ${scores.length} quiz${scores.length === 1 ? "" : "zes"} — below the 50% threshold.`,
      related_coachee_id: userId,
      resolved: false,
    });
  });
  return alerts;
}

export interface ScanTriadGroupRow {
  id: string;
  name: string | null;
  memberIds: string[];
}

/** Active triad groups with no session logged in the last 7 days, or ever. */
export function buildTriadNotScheduledAlerts(opts: {
  activeGroups: ScanTriadGroupRow[];
  lastSessionDateByGroup: Map<string, string>;
  nameById: Map<string, string | null | undefined>;
  now: Date;
}): ProgrammeAlert[] {
  const { activeGroups, lastSessionDateByGroup, nameById, now } = opts;
  const cutoff = now.getTime() - 7 * 24 * 60 * 60 * 1000;

  return activeGroups
    .filter((g) => {
      const last = lastSessionDateByGroup.get(g.id);
      return !last || new Date(last).getTime() < cutoff;
    })
    .map((g) => {
      const memberNames = g.memberIds.map((id) => nameById.get(id) || "—").join(", ");
      const last = lastSessionDateByGroup.get(g.id);
      const sinceText = last ? `last session ${format(new Date(last), "d MMM yyyy")}` : "no session logged yet";
      return {
        severity: "warning" as const,
        alert_type: "triad_not_scheduled" as const,
        title: `${g.name || "Triad group"} — no session in 7+ days`,
        message: `${memberNames} haven't logged a triad session in over a week (${sinceText}).`,
        related_coachee_id: null,
        resolved: false,
      };
    });
}
