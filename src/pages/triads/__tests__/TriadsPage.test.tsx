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

// Cohort C: every required Triad has its own group. Triad 1 group
// (Demo Learner, Caleb, Hana): completed 16 Feb. Triad 2 group (Demo Learner,
// Minh, Lan — nobody repeats): confirmed 20 Apr. Programme requires 2;
// Triad 1 due 05 Apr, Triad 2 due 05 Jul.
const HISTORY = [
  { id: "k1", enrollmentId: "enrollment-1", type: "triad", title: "", startTime: "2026-02-16T03:00:00Z", status: "completed", sourceId: "t1", sourceType: "triad_sessions", isProgrammeEvidence: true, participantRole: null, counterpartNames: ["Caleb Ong", "Hana Bui"], requirementUnitNumber: 1 },
  { id: "k2", enrollmentId: "enrollment-1", type: "triad", title: "", startTime: "2026-04-20T03:00:00Z", status: "confirmed", sourceId: "t2", sourceType: "triad_sessions", isProgrammeEvidence: false, participantRole: null, counterpartNames: ["Lan Tran", "Minh Vo"], requirementUnitNumber: 2 },
];

function session(overrides: Partial<TriadSessionView>): TriadSessionView {
  return {
    id: "t2",
    sessionNumber: 1,
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

const SELF = { id: "learner-1", full_name: "Demo Learner", avatar_url: null, slot: 1, isSelf: true };
const TRIAD_1_MEMBERS = [
  SELF,
  { id: "caleb", full_name: "Caleb Ong", avatar_url: null, slot: 2, isSelf: false },
  { id: "hana", full_name: "Hana Bui", avatar_url: null, slot: 3, isSelf: false },
];
const TRIAD_2_MEMBERS = [
  SELF,
  { id: "minh", full_name: "Minh Vo", avatar_url: null, slot: 2, isSelf: false },
  { id: "lan", full_name: "Lan Tran", avatar_url: null, slot: 3, isSelf: false },
];

function group(unit: 1 | 2, sessions: TriadSessionView[], overrides: Partial<TriadGroupEntry> = {}): TriadGroupEntry {
  const open = sessions.filter((s) => s.status === "proposed" || s.status === "confirmed");
  return {
    enrollmentId: "enrollment-1",
    groupId: `g${unit}`,
    requirementId: `req-${unit}`,
    unitNumber: unit,
    dueOn: unit === 1 ? "2026-04-05" : "2026-07-05",
    cohortId: "cohort-c",
    groupLanguage: "en",
    isActive: true,
    closedAt: null,
    createdAt: unit === 1 ? "2026-01-20T00:00:00Z" : "2026-03-01T00:00:00Z",
    memberCount: 3,
    mySlot: 1,
    sessions,
    session: open[open.length - 1] ?? sessions[sessions.length - 1] ?? null,
    members: unit === 1 ? TRIAD_1_MEMBERS : TRIAD_2_MEMBERS,
    ...overrides,
  };
}

const COMPLETED_T1 = session({ id: "t1", status: "completed", scheduledStartTime: "2026-02-16T03:00:00Z", reflectionSubmitted: true, reflectionSatisfaction: 4 });
const CONFIRMED_T2 = session({ id: "t2" });
const TRIAD_1_GROUP = group(1, [COMPLETED_T1]);
const TRIAD_2_GROUP = group(2, [CONFIRMED_T2]);

function status(overrides: Partial<TriadStatusView> = {}): TriadStatusView {
  return {
    requiredUnits: 2,
    completedUnits: 1,
    rawCompletedSessions: 1,
    dueUnits: 1,
    overdueUnits: 0,
    bookedUnits: 1,
    paceStatus: "on_track",
    nextDueOn: "2026-07-05",
    schedule: [
      { milestone: 1, requirementId: "req-1", dueOn: "2026-04-05", trainingWeekId: null, isDue: true, satisfied: true, fulfilledOn: "2026-02-16", overdue: false, triadGroupId: "g1" },
      { milestone: 2, requirementId: "req-2", dueOn: "2026-07-05", trainingWeekId: null, isDue: false, satisfied: false, fulfilledOn: null, overdue: false, triadGroupId: "g2" },
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

const section = (unit: number) => screen.getAllByTestId("triad-requirement").find((s) => s.getAttribute("data-unit") === String(unit))!;

beforeEach(() => {
  myTriads.mockReturnValue({ groups: [TRIAD_1_GROUP, TRIAD_2_GROUP], loading: false, error: false, refetch: vi.fn() });
  myTriadStatus.mockReturnValue({ status: status(), loading: false, error: false });
  enrollmentSessions.mockReturnValue({ sessions: HISTORY, loading: false, error: null });
});

describe("TriadsPage", () => {
  it("reads the learner's Triad groups and canonical status for the selected enrollment", () => {
    renderPage();
    expect(myTriads).toHaveBeenCalledWith("enrollment-1");
    expect(myTriadStatus).toHaveBeenCalledWith("enrollment-1");
  });

  it("Cohort C: one section per required Triad — Triad 1 completed (16 Feb), Triad 2 confirmed (20 Apr) = 1/2", () => {
    renderPage();
    expect(screen.getByTestId("triad-progress-pill")).toHaveTextContent("1/2 completed");
    expect(screen.getByTestId("triad-status-progress")).toHaveTextContent("Triads 1/2 completed");
    expect(screen.getByTestId("triad-next-deadline")).toHaveTextContent("Jul 5, 2026");
    expect(within(screen.getByTestId("triad-schedule")).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      expect.stringContaining("Triad 1"),
      expect.stringContaining("Triad 2"),
    ]);
    expect(screen.getAllByTestId("triad-requirement").map((s) => s.getAttribute("data-unit"))).toEqual(["1", "2"]);
    expect(section(1)).toHaveAttribute("data-state", "completed");
    expect(within(section(1)).getByTestId("triad-requirement-done")).toHaveTextContent("Triad 1 is complete");
    expect(section(2)).toHaveAttribute("data-state", "assigned");
    expect(within(section(2)).getByTestId("triad-requirement-title")).toHaveTextContent("Triad 2");
    expect(section(2)).toHaveTextContent("Jul 5, 2026");
    expect(document.body).not.toHaveTextContent(/Round \d/);
  });

  it("each Triad shows ITS own group: different members for Triad 1 and Triad 2, no fixed roles", () => {
    renderPage();
    const names = (unit: number) => within(within(section(unit)).getByTestId("triad-group")).getAllByTestId("triad-member").map((m) => m.textContent);
    expect(names(1)).toEqual([expect.stringContaining("Demo Learner"), expect.stringContaining("Caleb Ong"), expect.stringContaining("Hana Bui")]);
    expect(names(2)).toEqual([expect.stringContaining("Demo Learner"), expect.stringContaining("Minh Vo"), expect.stringContaining("Lan Tran")]);
    const card = within(section(2)).getByTestId("triad-group");
    expect(card).toHaveTextContent("My Triad 2 group");
    expect(card).not.toHaveTextContent(/Your role|Coachee|Observer/);
    expect(card).toHaveTextContent("Everyone rotates through coach, coachee and observer.");
  });

  it("the Triad 2 group's open session is shown in the Triad 2 section", () => {
    renderPage();
    expect(section(2)).toHaveTextContent("Triad 2");
    expect(within(section(2)).queryByTestId("triad-schedule-next")).toBeNull();
    expect(within(section(1)).queryByTestId("triad-schedule-next")).toBeNull();
  });

  it("Triad 2 without a group: 'Group assignment pending' — Triad 1 stays completed", () => {
    myTriads.mockReturnValue({ groups: [TRIAD_1_GROUP], loading: false, error: false, refetch: vi.fn() });
    renderPage();
    expect(section(1)).toHaveAttribute("data-state", "completed");
    expect(section(2)).toHaveAttribute("data-state", "pending");
    expect(within(section(2)).getByTestId("triad-no-group")).toHaveTextContent("Group assignment pending");
    expect(within(section(2)).getByTestId("triad-group-pending")).toBeInTheDocument();
  });

  it("a Triad 2 group without a session proposes one (never reuses the Triad 1 group)", () => {
    myTriads.mockReturnValue({ groups: [TRIAD_1_GROUP, group(2, [])], loading: false, error: false, refetch: vi.fn() });
    renderPage();
    const next = within(section(2)).getByTestId("triad-schedule-next");
    expect(next).toHaveTextContent("No session scheduled");
    expect(within(next).getByRole("button", { name: "Schedule the next session" })).toBeInTheDocument();
    expect(within(section(1)).queryByTestId("triad-schedule-next")).toBeNull();
  });

  it("an overdue Triad is marked overdue in its own section", () => {
    myTriadStatus.mockReturnValue({
      status: status({
        overdueUnits: 1,
        schedule: [
          status().schedule[0],
          { ...status().schedule[1], isDue: true, overdue: true },
        ],
      }),
      loading: false,
      error: false,
    });
    renderPage();
    expect(section(2)).toHaveAttribute("data-state", "overdue");
    expect(within(section(2)).getByTestId("triad-requirement-state")).toHaveTextContent("Overdue");
    expect(screen.getByTestId("triad-overdue")).toHaveTextContent("1 Triad session overdue");
  });

  it("history labels each session with its Triad", () => {
    renderPage();
    const history = screen.getByTestId("triad-history");
    expect(within(history).getByTestId("triad-progress")).toHaveTextContent("Triads programme progress: 1/2 completed");
    const rows = within(history).getAllByTestId("session-row");
    expect(rows.map((r) => r.getAttribute("data-status"))).toEqual(["completed", "confirmed"]);
    expect(rows[0]).toHaveTextContent("Triad 1");
    expect(rows[1]).toHaveTextContent("Triad 2");
    expect(within(history).getAllByTestId("programme-evidence")).toHaveLength(1);
    const hrefs = within(history).getAllByRole("link").map((l) => l.getAttribute("href"));
    expect(hrefs).toContain("/triads/t1");
    expect(hrefs).toContain("/triads/t2");
  });

  it("a closed earlier group is kept as history", () => {
    myTriads.mockReturnValue({ groups: [group(1, [COMPLETED_T1], { isActive: false, closedAt: "2026-03-01T00:00:00Z" })], loading: false, error: false, refetch: vi.fn() });
    renderPage();
    expect(within(section(1)).getByTestId("triad-group")).toHaveTextContent("Earlier group (closed)");
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
    expect(screen.queryAllByTestId("triad-requirement")).toHaveLength(0);
  });

  it("shows the learner's own reflection status per session from the Triad read model", () => {
    renderPage();
    const [done, upcoming] = within(screen.getByTestId("triad-history")).getAllByTestId("session-row");
    expect(done).toHaveTextContent("4 / 5");
    expect(upcoming).toHaveTextContent("After session");

    myTriads.mockReturnValue({
      groups: [group(1, [session({ id: "t1", status: "completed", reflectionSubmitted: false })])],
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
