import { describe, it, expect } from "vitest";
import {
  buildFeedbackAlerts,
  buildMentoringPrepFileOverdueAlerts,
  buildMentoringFeedbackOverdueAlerts,
  ScanPeerSessionRow,
  ScanSessionRow,
  ScanMentoringSessionRow,
} from "../alertScan";

const NOW = new Date("2026-08-10T12:00:00.000Z");
const PAST = "2026-08-05T10:00:00.000Z";
const FUTURE = "2026-08-20T10:00:00.000Z";

const nameById = new Map([
  ["coachee-1", "Jane Coachee"],
  ["peer-coachee-1", "Priya Peer"],
]);
const emailById = new Map([
  ["coachee-1", "jane@example.com"],
  ["peer-coachee-1", null],
]);

function regularSession(overrides: Partial<ScanSessionRow>): ScanSessionRow {
  return {
    id: "s1",
    coachee_id: "coachee-1",
    status: "confirmed",
    start_time: PAST,
    coachee_notes: null,
    ...overrides,
  };
}

function peerSession(overrides: Partial<ScanPeerSessionRow>): ScanPeerSessionRow {
  return {
    id: "ps1",
    peer_coachee_id: "peer-coachee-1",
    status: "confirmed",
    start_time: PAST,
    ...overrides,
  };
}

const base = { peerFeedbackSessionIds: new Set<string>(), nameById, emailById, now: NOW };

describe("buildFeedbackAlerts — regular sessions", () => {
  it("flags a blocked confirmed session (started, no reflection) as a warning", () => {
    const alerts = buildFeedbackAlerts({
      ...base,
      sessions: [regularSession({ status: "confirmed", start_time: PAST, coachee_notes: null })],
      peerSessions: [],
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe("warning");
    expect(alerts[0].alert_type).toBe("feedback_response");
    expect(alerts[0].related_coachee_id).toBe("coachee-1");
    expect(alerts[0].title).toContain("reflection still missing");
    expect(alerts[0].message).toContain("Jane Coachee");
    expect(alerts[0].message).toContain("(jane@example.com)");
  });

  it("does not flag a confirmed session that hasn't started yet, even with no reflection", () => {
    const alerts = buildFeedbackAlerts({
      ...base,
      sessions: [regularSession({ status: "confirmed", start_time: FUTURE, coachee_notes: null })],
      peerSessions: [],
    });
    expect(alerts).toHaveLength(0);
  });

  it("does not flag a confirmed, started session once a reflection exists", () => {
    const alerts = buildFeedbackAlerts({
      ...base,
      sessions: [
        regularSession({ status: "confirmed", start_time: PAST, coachee_notes: "Great session." }),
      ],
      peerSessions: [],
    });
    expect(alerts).toHaveLength(0);
  });

  it("treats whitespace-only reflection as still missing", () => {
    const alerts = buildFeedbackAlerts({
      ...base,
      sessions: [regularSession({ status: "confirmed", start_time: PAST, coachee_notes: "   " })],
      peerSessions: [],
    });
    expect(alerts).toHaveLength(1);
  });

  it("flags a completed session with no reflection as info (retroactive case)", () => {
    const alerts = buildFeedbackAlerts({
      ...base,
      sessions: [regularSession({ status: "completed", coachee_notes: null })],
      peerSessions: [],
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe("info");
    expect(alerts[0].title).toContain("reflection missing (completed session)");
  });

  it("does not flag a completed session that has a reflection", () => {
    const alerts = buildFeedbackAlerts({
      ...base,
      sessions: [regularSession({ status: "completed", coachee_notes: "Reflected." })],
      peerSessions: [],
    });
    expect(alerts).toHaveLength(0);
  });

  it("ignores pending/cancelled sessions regardless of reflection state", () => {
    const alerts = buildFeedbackAlerts({
      ...base,
      sessions: [
        regularSession({ status: "pending_coach_approval", coachee_notes: null }),
        regularSession({ id: "s2", status: "cancelled", coachee_notes: null }),
      ],
      peerSessions: [],
    });
    expect(alerts).toHaveLength(0);
  });

  it("omits the parenthesised contact when the coachee has no email on file", () => {
    const alerts = buildFeedbackAlerts({
      ...base,
      sessions: [
        regularSession({ status: "completed", coachee_id: "peer-coachee-1", coachee_notes: null }),
      ],
      peerSessions: [],
    });
    expect(alerts[0].message).not.toContain("(");
  });
});

describe("buildFeedbackAlerts — peer sessions", () => {
  it("flags a blocked confirmed peer session (started, no feedback row) as a warning", () => {
    const alerts = buildFeedbackAlerts({
      ...base,
      sessions: [],
      peerSessions: [peerSession({ status: "confirmed", start_time: PAST })],
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe("warning");
    expect(alerts[0].related_coachee_id).toBe("peer-coachee-1");
    expect(alerts[0].title).toContain("competency feedback still missing");
  });

  it("does not flag a peer session once a feedback row exists", () => {
    const alerts = buildFeedbackAlerts({
      ...base,
      peerFeedbackSessionIds: new Set(["ps1"]),
      sessions: [],
      peerSessions: [peerSession({ id: "ps1", status: "confirmed", start_time: PAST })],
    });
    expect(alerts).toHaveLength(0);
  });

  it("does not flag a confirmed peer session that hasn't started yet", () => {
    const alerts = buildFeedbackAlerts({
      ...base,
      sessions: [],
      peerSessions: [peerSession({ status: "confirmed", start_time: FUTURE })],
    });
    expect(alerts).toHaveLength(0);
  });

  it("flags a completed peer session with no feedback row as info", () => {
    const alerts = buildFeedbackAlerts({
      ...base,
      sessions: [],
      peerSessions: [peerSession({ status: "completed" })],
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe("info");
    expect(alerts[0].title).toContain("competency feedback missing (completed session)");
  });

  it("does not flag a completed peer session once a feedback row exists", () => {
    const alerts = buildFeedbackAlerts({
      ...base,
      peerFeedbackSessionIds: new Set(["ps1"]),
      sessions: [],
      peerSessions: [peerSession({ id: "ps1", status: "completed" })],
    });
    expect(alerts).toHaveLength(0);
  });
});

describe("buildFeedbackAlerts — mixed", () => {
  it("raises independent alerts for a blocked regular session and a blocked peer session together", () => {
    const alerts = buildFeedbackAlerts({
      ...base,
      sessions: [regularSession({ status: "confirmed", start_time: PAST, coachee_notes: null })],
      peerSessions: [peerSession({ status: "confirmed", start_time: PAST })],
    });
    expect(alerts).toHaveLength(2);
    expect(alerts.map((a) => a.related_coachee_id).sort()).toEqual(
      ["coachee-1", "peer-coachee-1"].sort()
    );
  });
});

function mentoringSession(overrides: Partial<ScanMentoringSessionRow>): ScanMentoringSessionRow {
  return {
    id: "ms1",
    mentee_id: "coachee-1",
    status: "confirmed",
    start_time: PAST,
    prep_file_path: null,
    feedback_submitted_at: null,
    ...overrides,
  };
}

describe("buildMentoringPrepFileOverdueAlerts", () => {
  it("flags a blocked confirmed session (started, no prep file) as a warning", () => {
    const alerts = buildMentoringPrepFileOverdueAlerts({
      mentoringSessions: [mentoringSession({ status: "confirmed", start_time: PAST, prep_file_path: null })],
      nameById,
      emailById,
      now: NOW,
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe("warning");
    expect(alerts[0].alert_type).toBe("mentoring_prep_file");
    expect(alerts[0].related_coachee_id).toBe("coachee-1");
    expect(alerts[0].title).toContain("preparation file still missing");
    expect(alerts[0].message).toContain("Jane Coachee");
  });

  it("does not flag a confirmed session that hasn't started yet", () => {
    const alerts = buildMentoringPrepFileOverdueAlerts({
      mentoringSessions: [mentoringSession({ status: "confirmed", start_time: FUTURE, prep_file_path: null })],
      nameById,
      emailById,
      now: NOW,
    });
    expect(alerts).toHaveLength(0);
  });

  it("does not flag a session once a prep file has been submitted", () => {
    const alerts = buildMentoringPrepFileOverdueAlerts({
      mentoringSessions: [mentoringSession({ status: "confirmed", start_time: PAST, prep_file_path: "ms1/prep.pdf" })],
      nameById,
      emailById,
      now: NOW,
    });
    expect(alerts).toHaveLength(0);
  });

  it("ignores completed sessions (prep file is now hard-gated, so a completed session already has one)", () => {
    const alerts = buildMentoringPrepFileOverdueAlerts({
      mentoringSessions: [mentoringSession({ status: "completed", prep_file_path: null })],
      nameById,
      emailById,
      now: NOW,
    });
    expect(alerts).toHaveLength(0);
  });
});

describe("buildMentoringFeedbackOverdueAlerts", () => {
  it("flags a completed session with no mentor feedback as info", () => {
    const alerts = buildMentoringFeedbackOverdueAlerts({
      mentoringSessions: [mentoringSession({ status: "completed", feedback_submitted_at: null })],
      nameById,
      emailById,
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe("info");
    expect(alerts[0].alert_type).toBe("mentoring_feedback");
    expect(alerts[0].title).toContain("mentor feedback missing (completed session)");
  });

  it("does not flag a completed session once feedback has been submitted", () => {
    const alerts = buildMentoringFeedbackOverdueAlerts({
      mentoringSessions: [mentoringSession({ status: "completed", feedback_submitted_at: "2026-08-06T10:00:00.000Z" })],
      nameById,
      emailById,
    });
    expect(alerts).toHaveLength(0);
  });

  it("does not flag a confirmed (not yet completed) session even with no feedback", () => {
    const alerts = buildMentoringFeedbackOverdueAlerts({
      mentoringSessions: [mentoringSession({ status: "confirmed", feedback_submitted_at: null })],
      nameById,
      emailById,
    });
    expect(alerts).toHaveLength(0);
  });
});
