import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TriadGroupEntry, TriadSessionView, TriadStatusView } from "@/hooks/triads/useMyTriads";

const myTriads = vi.fn();
const myTriadStatus = vi.fn();
const enrollmentSessions = vi.fn();

vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "learner-1" } }) }));
vi.mock("@/hooks/useEnrollmentContext", () => ({
  useEnrollmentContext: () => ({ selectedEnrollment: { id: "enrollment-1" }, loading: false }),
}));
vi.mock("@/hooks/triads/useMyTriads", () => ({
  // The one learner Triad read model (learner_triad_overview + canonical members)
  // and the canonical Triad status (learner_triad_status).
  useMyTriads: (enrollmentId: string | null) => myTriads(enrollmentId),
  useMyTriadStatus: (enrollmentId: string | null) => myTriadStatus(enrollmentId),
  pendingMembers: () => [],
}));
vi.mock("@/hooks/triads/useTriadSession", () => ({
  useTriadSession: () => ({
    scheduleSession: vi.fn(),
    acceptSession: vi.fn(),
    markCompleted: vi.fn(),
    proposeAlternative: vi.fn(),
    acceptAlternative: vi.fn(),
    isPending: false,
  }),
}));
vi.mock("@/hooks/useLearnerCanonicalProgress", () => ({
  useLearnerCanonicalProgress: () => ({
    progress: { triad_completed_units: 1, triad_required_units: 2, programme_label: "Emerging Leaders", cohort_label: "Cohort C" },
    loading: false,
    error: null,
  }),
}));
vi.mock("@/hooks/journey/useEnrollmentSessions", () => ({
  useEnrollmentSessions: () => enrollmentSessions(),
}));

import "@/i18n/config";
import TriadsPage from "../TriadsPage";

// Cohort C: one cohort group; Session 1 on 16 Feb completed, Session 2 on
// 20 Apr confirmed. Programme requires 2; cumulative dates 05 Apr / 05 Jul.
const HISTORY = [
  { id: "k1", enrollmentId: "enrollment-1", type: "triad", title: "", startTime: "2026-02-16T03:00:00Z", status: "completed", sourceId: "t1", sourceType: "triad_sessions", isProgrammeEvidence: true, participantRole: null, counterpartNames: ["Caleb Ong", "Hana Bui"] },
  { id: "k2", enrollmentId: "enrollment-1", type: "triad", title: "", startTime: "2026-04-20T03:00:00Z", status: "confirmed", sourceId: "t2", sourceType: "triad_sessions", isProgrammeEvidence: false, participantRole: null, counterpartNames: ["Caleb Ong", "Hana Bui"] },
];

function session(overrides: Partial<TriadSessionView>): TriadSessionView {
  return {
    id: "t2",
    sessionNumber: 2,
    status: "confirmed",
    scheduledStartTime: "2026-04-20T03:00:00Z",
    scheduledEndTime: "2026-04-20T04:00:00Z",
    meetingUrl: null,
    createdAt: "2026-04-01T00:00:00Z",
    canComplete: false,
    myResponse: "accepted",
    responses: [],
    reflectionSubmitted: false,
    reflectionSatisfaction: null,
    pendingAlternatives: [],
    ...overrides,
  };
}

const MEMBERS = [
  { id: "learner-1", full_name: "Demo Learner", avatar_url: null, slot: 1, isSelf: true },
  { id: "caleb", full_name: "Caleb Ong", avatar_url: null, slot: 2, isSelf: false },
  { id: "hana", full_name: "Hana Bui", avatar_url: null, slot: 3, isSelf: false },
];

function group(sessions: TriadSessionView[], overrides: Partial<TriadGroupEntry> = {}): TriadGroupEntry {
  const open = sessions.filter((s) => s.status === "proposed" || s.status === "confirmed");
  return {
    enrollmentId: "enrollment-1",
    groupId: "g1",
    cohortId: "cohort-c",
    groupLanguage: "en",
    isActive: true,
    closedAt: null,
    createdAt: "2026-01-20T00:00:00Z",
    memberCount: 3,
    mySlot: 1,
    sessions,
    session: open[open.length - 1] ?? sessions[sessions.length - 1] ?? null,
    members: MEMBERS,
    ...overrides,
  };
}

const COMPLETED_1 = session({ id: "t1", sessionNumber: 1, status: "completed", scheduledStartTime: "2026-02-16T03:00:00Z", reflectionSubmitted: true, reflectionSatisfaction: 4 });
const CONFIRMED_2 = session({ id: "t2", sessionNumber: 2 });
const COHORT_C_GROUP = group([COMPLETED_1, CONFIRMED_2]);

function status(overrides: Partial<TriadStatusView> = {}): TriadStatusView {
  return {
    requiredUnits: 2,
    completedUnits: 1,
    rawCompletedSessions: 1,
    dueUnits: 2,
    overdueUnits: 1,
    bookedUnits: 0,
    paceStatus: "behind",
    nextDueOn: "2026-07-05",
    schedule: [
      { milestone: 1, dueOn: "2026-04-05", trainingWeekId: null, isDue: true, satisfied: true },
      { milestone: 2, dueOn: "2026-07-05", trainingWeekId: null, isDue: true, satisfied: false },
    ],
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <TriadsPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  myTriads.mockReturnValue({ groups: [COHORT_C_GROUP], loading: false, error: false, refetch: vi.fn() });
  myTriadStatus.mockReturnValue({ status: status(), loading: false, error: false });
  enrollmentSessions.mockReturnValue({ sessions: HISTORY, loading: false, error: null });
});

describe("TriadsPage", () => {
  it("reads the learner's Triad groups and canonical status for the selected enrollment", () => {
    renderPage();
    expect(myTriads).toHaveBeenCalledWith("enrollment-1");
    expect(myTriadStatus).toHaveBeenCalledWith("enrollment-1");
  });

  it("Cohort C: 16 Feb completed + 20 Apr confirmed in one group = 1/2, next deadline 05 Jul — no rounds", () => {
    renderPage();
    expect(screen.getByTestId("triad-progress-pill")).toHaveTextContent("1/2 completed");
    expect(screen.getByTestId("triad-status-progress")).toHaveTextContent("Triads 1/2 completed");
    expect(screen.getByTestId("triad-next-deadline")).toHaveTextContent("Jul 5, 2026");
    expect(screen.getByTestId("triad-overdue")).toHaveTextContent("1 Triad session overdue");
    expect(within(screen.getByTestId("triad-schedule")).getAllByRole("listitem")).toHaveLength(2);
    const history = screen.getByTestId("triad-history");
    expect(within(history).getByTestId("triad-progress")).toHaveTextContent("Triads programme progress: 1/2 completed");
    const rows = within(history).getAllByTestId("session-row");
    expect(rows.map((r) => r.getAttribute("data-status"))).toEqual(["completed", "confirmed"]);
    expect(rows[0]).toHaveTextContent("Session 1");
    expect(rows[1]).toHaveTextContent("Session 2");
    expect(within(history).getAllByTestId("programme-evidence")).toHaveLength(1);
    const hrefs = within(history).getAllByRole("link").map((l) => l.getAttribute("href"));
    expect(hrefs).toContain("/triads/t1");
    expect(hrefs).toContain("/triads/t2");
    expect(document.body).not.toHaveTextContent(/Round \d/);
  });

  it("the same active group's open session is the current one (Session 2)", () => {
    renderPage();
    const current = screen.getByTestId("triad-current");
    expect(current).toHaveTextContent("Session 2");
    expect(within(current).queryByTestId("triad-schedule-next")).toBeNull();
  });

  it("shows the group members without fixed roles", () => {
    renderPage();
    const card = screen.getByTestId("triad-group");
    const members = within(card).getAllByTestId("triad-member");
    expect(members.map((m) => m.textContent)).toEqual([
      expect.stringContaining("Demo Learner"),
      expect.stringContaining("Caleb Ong"),
      expect.stringContaining("Hana Bui"),
    ]);
    expect(members[0]).toHaveTextContent("You");
    expect(card).not.toHaveTextContent(/Your role|Coachee|Observer/);
    expect(card).toHaveTextContent("Everyone rotates through coach, coachee and observer.");
  });

  it("after Session 1 completes, the same active group schedules the next session (no new group needed)", () => {
    myTriads.mockReturnValue({ groups: [group([COMPLETED_1])], loading: false, error: false, refetch: vi.fn() });
    renderPage();
    const next = screen.getByTestId("triad-schedule-next");
    expect(next).toHaveTextContent("No session scheduled");
    expect(within(next).getByRole("button", { name: "Schedule the next session" })).toBeInTheDocument();
  });

  it("a learner without an active group sees that, and keeps their earlier sessions", () => {
    myTriads.mockReturnValue({ groups: [group([COMPLETED_1], { isActive: false, closedAt: "2026-03-01T00:00:00Z" })], loading: false, error: false, refetch: vi.fn() });
    renderPage();
    expect(screen.getByTestId("triad-no-group")).toBeInTheDocument();
    expect(screen.getByTestId("triad-group")).toHaveTextContent("Earlier group (closed)");
    expect(within(screen.getByTestId("triad-history")).getAllByTestId("session-row")).toHaveLength(2);
  });

  it("extra sessions beyond the requirement are kept as activity (raw 3, canonical 2/2)", () => {
    myTriadStatus.mockReturnValue({ status: status({ completedUnits: 2, rawCompletedSessions: 3, overdueUnits: 0, nextDueOn: null }), loading: false, error: false });
    renderPage();
    expect(screen.getByTestId("triad-status-progress")).toHaveTextContent("Triads 2/2 completed");
    expect(screen.getByTestId("triad-status")).toHaveTextContent("1 extra session beyond the requirement");
    expect(screen.getByTestId("triad-status")).toHaveTextContent("All required Triad sessions completed");
  });

  it("a programme without Triads says so (never a fake 0/0)", () => {
    myTriadStatus.mockReturnValue({ status: status({ requiredUnits: 0, completedUnits: 0, schedule: [] }), loading: false, error: false });
    renderPage();
    expect(screen.getByTestId("triad-progress-pill")).toHaveTextContent("Not required");
    expect(screen.getByTestId("triad-status")).toHaveTextContent("No Triads are required in this programme");
  });

  it("shows the learner's own reflection status per session from the Triad read model", () => {
    renderPage();
    const [done, upcoming] = within(screen.getByTestId("triad-history")).getAllByTestId("session-row");
    expect(done).toHaveTextContent("4 / 5");
    expect(upcoming).toHaveTextContent("After session");

    myTriads.mockReturnValue({
      groups: [group([session({ id: "t1", sessionNumber: 1, status: "completed", reflectionSubmitted: false })])],
      loading: false,
      error: false,
      refetch: vi.fn(),
    });
    renderPage();
    const rows = within(screen.getAllByTestId("triad-history")[1]).getAllByTestId("session-row");
    expect(rows[0]).toHaveTextContent("Due now");
    expect(within(rows[0]).getByRole("link", { name: "Due now" })).toHaveAttribute("href", "/triads/t1/reflect");
  });

  it("shows a load error for triad history instead of an empty state", () => {
    enrollmentSessions.mockReturnValue({ sessions: [], loading: false, error: "boom" });
    renderPage();
    const history = screen.getByTestId("triad-history");
    expect(history).toHaveTextContent("Your triad sessions could not be loaded.");
    expect(history).not.toHaveTextContent("No triad sessions yet.");
  });
});
