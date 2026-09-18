import { describe, expect, it } from "vitest";
import { normalizeTriadSession } from "../useSessionsData";
import type { TriadGroupEntry, TriadSessionView } from "@/hooks/triads/useMyTriads";

const session: TriadSessionView = {
  id: "triad-session-1",
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
  requirementId: "requirement-2",
  unitNumber: 2,
  dueOn: "2026-10-01",
  trainingWeek: { number: 4, title: "Week four", titleVi: null },
  groupLanguage: "en",
  isActive: true,
  memberCount: 3,
  mySlot: 2,
  unitCompleted: false,
  unitOverdue: false,
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
  it("owns the session through the learner's member enrollment and keeps the requirement context", () => {
    const normalized = normalizeTriadSession(group(), session);
    expect(normalized.kind).toBe("triad");
    expect(normalized.enrollment_id).toBe("enrollment-member");
    expect(normalized.start_time).toBe("2026-09-20T10:00:00Z");
    expect(normalized.triad.roundNumber).toBe(2);
    expect(normalized.triad.weekNumber).toBe(4);
    expect(normalized.triad.participantNames).toEqual(["One", "Two", "Three"]);
    // Every member rotates roles: no per-session role is invented.
    expect(normalized.triad).not.toHaveProperty("role");
  });

  it("does not invent round or week values when the group has no requirement context", () => {
    const normalized = normalizeTriadSession(group({ unitNumber: null, trainingWeek: null }), { ...session, scheduledStartTime: null });
    expect(normalized.triad.roundNumber).toBeNull();
    expect(normalized.triad.weekNumber).toBeNull();
    expect(normalized.start_time).toBeNull();
  });
});
