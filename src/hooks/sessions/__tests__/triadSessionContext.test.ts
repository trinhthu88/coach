import { describe, expect, it } from "vitest";
import { normalizeTriadSession } from "../useSessionsData";
import type { TriadGroupEntry, TriadSessionView } from "@/hooks/triads/useMyTriads";

const session: TriadSessionView = {
  id: "triad-session-1",
  sessionNumber: 2,
  status: "proposed",
  scheduledStartTime: "2026-09-20T10:00:00Z",
  scheduledEndTime: "2026-09-20T11:00:00Z",
  meetingUrl: null,
  createdAt: "2026-09-01T00:00:00Z",
  canComplete: false,
  myResponse: "pending",
  responses: [],
  reflectionSubmitted: false,
  reflectionSatisfaction: null,
  pendingAlternatives: [],
};

const group = (overrides: Partial<TriadGroupEntry> = {}): TriadGroupEntry => ({
  enrollmentId: "enrollment-member",
  groupId: "group-1",
  requirementId: "req-2",
  unitNumber: 2,
  dueOn: "2026-10-06",
  cohortId: "cohort-1",
  groupLanguage: "en",
  isActive: true,
  closedAt: null,
  createdAt: "2026-08-01T00:00:00Z",
  memberCount: 3,
  mySlot: 2,
  sessions: [session],
  session,
  members: [
    { id: "user-1", full_name: "One", avatar_url: null, slot: 1, isSelf: false },
    { id: "user-2", full_name: "Two", avatar_url: null, slot: 2, isSelf: true },
    { id: "user-3", full_name: "Three", avatar_url: null, slot: 3, isSelf: false },
  ],
  ...overrides,
});

describe("unified Triad session context", () => {
  it("owns the session through the learner's member enrollment; it is labelled by its group's Triad requirement", () => {
    const normalized = normalizeTriadSession(group(), session);
    expect(normalized.kind).toBe("triad");
    expect(normalized.enrollment_id).toBe("enrollment-member");
    expect(normalized.start_time).toBe("2026-09-20T10:00:00Z");
    // "Triad 2": the requirement of the session's group — no round, no week.
    expect(normalized.triad.unitNumber).toBe(2);
    expect(normalized.triad).not.toHaveProperty("roundNumber");
    expect(normalized.triad).not.toHaveProperty("weekNumber");
    expect(normalized.triad.participantNames).toEqual(["One", "Two", "Three"]);
    // Every member rotates roles: no per-session role is invented.
    expect(normalized.triad).not.toHaveProperty("role");
  });

  it("keeps a session of a closed (historical) group owned by its members", () => {
    const normalized = normalizeTriadSession(group({ isActive: false, closedAt: "2026-09-10T00:00:00Z" }), { ...session, scheduledStartTime: null });
    expect(normalized.enrollment_id).toBe("enrollment-member");
    expect(normalized.triad.participantNames).toEqual(["One", "Two", "Three"]);
    expect(normalized.start_time).toBeNull();
  });
});
