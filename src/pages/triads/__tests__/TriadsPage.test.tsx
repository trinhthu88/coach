import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TriadGroupEntry, TriadSessionView } from "@/hooks/triads/useMyTriads";

const myTriads = vi.fn();
const enrollmentSessions = vi.fn();

vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "learner-1" } }) }));
vi.mock("@/hooks/useEnrollmentContext", () => ({
  useEnrollmentContext: () => ({ selectedEnrollment: { id: "enrollment-1" }, loading: false }),
}));
vi.mock("@/hooks/triads/useMyTriads", () => ({
  // The one learner Triad read model (learner_triad_overview + canonical members).
  useMyTriads: (enrollmentId: string | null) => myTriads(enrollmentId),
  pendingMembers: () => [],
}));
vi.mock("@/hooks/triads/useTriadSession", () => ({
  useTriadSession: () => ({ acceptSession: vi.fn(), markCompleted: vi.fn(), proposeAlternative: vi.fn(), acceptAlternative: vi.fn(), isPending: false }),
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

const HISTORY = [
  { id: "k1", enrollmentId: "enrollment-1", type: "triad", title: "Round 1", startTime: "2026-02-16T03:00:00Z", status: "completed", sourceId: "t1", sourceType: "triad_sessions", isProgrammeEvidence: true, participantRole: null, counterpartNames: ["Caleb Ong", "Hana Bui"] },
  { id: "k2", enrollmentId: "enrollment-1", type: "triad", title: "Round 2", startTime: "2026-04-20T03:00:00Z", status: "confirmed", sourceId: "t2", sourceType: "triad_sessions", isProgrammeEvidence: false, participantRole: null, counterpartNames: ["Caleb Ong", "Hana Bui"] },
];

function session(overrides: Partial<TriadSessionView>): TriadSessionView {
  return {
    id: "t2",
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

function group(unitNumber: number, sessions: TriadSessionView[], overrides: Partial<TriadGroupEntry> = {}): TriadGroupEntry {
  return {
    enrollmentId: "enrollment-1",
    groupId: `g${unitNumber}`,
    requirementId: `r${unitNumber}`,
    unitNumber,
    dueOn: unitNumber === 1 ? "2026-03-01" : "2026-05-03",
    trainingWeek: null,
    groupLanguage: "en",
    isActive: true,
    memberCount: 3,
    mySlot: 1,
    unitCompleted: unitNumber === 1,
    unitOverdue: false,
    sessions,
    session: sessions[sessions.length - 1] ?? null,
    members: MEMBERS,
    ...overrides,
  };
}

const COMPLETED_ROUND_1 = group(1, [session({ id: "t1", status: "completed", scheduledStartTime: "2026-02-16T03:00:00Z", reflectionSubmitted: true, reflectionSatisfaction: 4 })]);
const OPEN_ROUND_2 = group(2, [session({ id: "t2" })]);

function renderPage() {
  return render(
    <MemoryRouter>
      <TriadsPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  myTriads.mockReturnValue({ groups: [COMPLETED_ROUND_1], loading: false, error: false, refetch: vi.fn() });
  enrollmentSessions.mockReturnValue({ sessions: HISTORY, loading: false, error: null });
});

describe("TriadsPage", () => {
  it("reads the learner's Triad groups for the selected enrollment", () => {
    renderPage();
    expect(myTriads).toHaveBeenCalledWith("enrollment-1");
  });

  it("says no round is open without hiding the learner's existing triad sessions (1 completed + 1 confirmed = 1/2)", () => {
    renderPage();
    expect(screen.getByTestId("triad-round-pill")).toHaveTextContent("No round open");
    const history = screen.getByTestId("triad-history");
    expect(within(history).getByTestId("triad-progress")).toHaveTextContent("Triads programme progress: 1/2 completed");
    const rows = within(history).getAllByTestId("session-row");
    expect(rows.map((r) => r.getAttribute("data-status"))).toEqual(["completed", "confirmed"]);
    expect(within(history).getAllByTestId("programme-evidence")).toHaveLength(1);
    const hrefs = within(history).getAllByRole("link").map((l) => l.getAttribute("href"));
    expect(hrefs).toContain("/triads/t1");
    expect(hrefs).toContain("/triads/t2");
  });

  it("shows the next session from canonical history when no round is open", () => {
    renderPage();
    const next = screen.getByTestId("triad-next");
    expect(within(next).getByRole("link", { name: "Open Triad session" })).toHaveAttribute("href", "/triads/t2");
  });

  it("shows the open round with its canonical due date, and members without fixed roles", () => {
    myTriads.mockReturnValue({ groups: [COMPLETED_ROUND_1, OPEN_ROUND_2], loading: false, error: false, refetch: vi.fn() });
    renderPage();
    expect(screen.getByTestId("triad-round-pill")).toHaveTextContent("Round 2 current");
    const card = screen.getByTestId("triad-group");
    expect(within(card).getByText("Round 2")).toBeInTheDocument();
    expect(within(card).getByTestId("triad-due")).toHaveTextContent("May 3, 2026");
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

  it("shows the learner's own reflection status per session from the Triad read model", () => {
    renderPage();
    const [done, upcoming] = within(screen.getByTestId("triad-history")).getAllByTestId("session-row");
    expect(done).toHaveTextContent("4 / 5");
    expect(done).toHaveTextContent("Submitted");
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
