import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const myTriads = vi.fn();
const sessionEntry = vi.fn();
const reflectionStatuses = vi.fn();
const enrollmentSessions = vi.fn();

vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "learner-1" } }) }));
vi.mock("@/hooks/useEnrollmentContext", () => ({
  useEnrollmentContext: () => ({ selectedEnrollment: { id: "enrollment-1" }, loading: false }),
}));
vi.mock("@/hooks/triads/useMyTriads", () => ({
  useMyTriads: () => myTriads(),
  // Group members come from the canonical triad member source via this hook.
  useTriadSessionEntry: (id: string | undefined) => sessionEntry(id),
}));
vi.mock("@/hooks/triads/useTriadReflection", () => ({
  useMyTriadReflectionStatuses: (ids: string[]) => reflectionStatuses(ids),
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
  { id: "k1", enrollmentId: "enrollment-1", type: "triad", title: "Round 1", startTime: "2026-02-16T03:00:00Z", status: "completed", sourceId: "t1", sourceType: "triad_sessions", isProgrammeEvidence: true, participantRole: "coach" },
  { id: "k2", enrollmentId: "enrollment-1", type: "triad", title: "Round 1", startTime: "2026-04-20T03:00:00Z", status: "confirmed", sourceId: "t2", sourceType: "triad_sessions", isProgrammeEvidence: false, participantRole: "coach" },
];

const GROUP_ENTRY = {
  round: null,
  roundNumber: 1,
  group: { id: "g1", member_1_id: "learner-1", member_2_id: "caleb", member_3_id: "hana", group_language: "en" },
  session: { id: "t2", status: "confirmed" },
  roleByMemberId: { "learner-1": "coach", caleb: "coachee", hana: "observer" },
  members: [
    { id: "learner-1", full_name: "Demo Learner", avatar_url: null },
    { id: "caleb", full_name: "Caleb Ong", avatar_url: null },
    { id: "hana", full_name: "Hana Bui", avatar_url: null },
  ],
  reflectionSubmitted: false,
};

function renderPage() {
  return render(
    <MemoryRouter>
      <TriadsPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  // No admin-configured round is open (the reported case).
  myTriads.mockReturnValue({ rounds: [], loading: false, error: false, refetch: vi.fn() });
  sessionEntry.mockReturnValue({ entry: GROUP_ENTRY, loading: false, error: null });
  reflectionStatuses.mockReturnValue({ statuses: new Map(), loading: false, error: null });
  enrollmentSessions.mockReturnValue({ sessions: HISTORY, loading: false, error: null });
});

describe("TriadsPage", () => {
  it("says no round is open without hiding the learner's existing triad sessions (1 completed + 1 confirmed = 1/2)", () => {
    renderPage();
    expect(screen.getByTestId("triad-round-pill")).toHaveTextContent("No round open");
    const current = screen.getByTestId("triad-current-rounds");
    expect(within(current).getByText("No triad round is open right now")).toBeInTheDocument();

    const history = screen.getByTestId("triad-history");
    expect(within(history).getByTestId("triad-progress")).toHaveTextContent("Triads programme progress: 1/2 completed");
    const rows = within(history).getAllByTestId("session-row");
    expect(rows.map((r) => r.getAttribute("data-status"))).toEqual(["completed", "confirmed"]);
    expect(within(history).getAllByTestId("programme-evidence")).toHaveLength(1);
    const hrefs = within(history).getAllByRole("link").map((l) => l.getAttribute("href"));
    expect(hrefs).toContain("/triads/t1");
    expect(hrefs).toContain("/triads/t2");
  });

  it("shows the next confirmed triad session from canonical history when no round is open", () => {
    renderPage();
    const next = screen.getByTestId("triad-next");
    expect(within(next).getByRole("link", { name: "Open Triad session" })).toHaveAttribute("href", "/triads/t2");
    // Focus session for the group card is the next open history session.
    expect(sessionEntry).toHaveBeenCalledWith("t2");
  });

  it("lists group members from the canonical triad member source with their session roles", () => {
    renderPage();
    const group = screen.getByTestId("triad-group");
    const members = within(group).getAllByTestId("triad-member");
    expect(members.map((m) => m.textContent)).toEqual([
      expect.stringContaining("Demo Learner"),
      expect.stringContaining("Caleb Ong"),
      expect.stringContaining("Hana Bui"),
    ]);
    expect(members[0]).toHaveTextContent("You");
    expect(members[0]).toHaveTextContent("Your role · Coach");
    expect(members[1]).toHaveTextContent("Coachee");
    expect(members[2]).toHaveTextContent("Observer");
  });

  it("shows the learner's own self-reflection status per round (submitted / due / after session)", () => {
    reflectionStatuses.mockReturnValue({ statuses: new Map(), loading: false, error: null });
    renderPage();
    const [done, upcoming] = within(screen.getByTestId("triad-history")).getAllByTestId("session-row");
    expect(done).toHaveTextContent("Due now");
    expect(within(done).getByRole("link", { name: "Due now" })).toHaveAttribute("href", "/triads/t1/reflect");
    expect(upcoming).toHaveTextContent("After session");

    reflectionStatuses.mockReturnValue({ statuses: new Map([["t1", { sessionId: "t1", submittedAt: "2026-02-17T00:00:00Z", selfRating: 4 }]]), loading: false, error: null });
    renderPage();
    const rows = within(screen.getAllByTestId("triad-history")[1]).getAllByTestId("session-row");
    expect(rows[0]).toHaveTextContent("4 / 5");
    expect(rows[0]).toHaveTextContent("Submitted");
  });

  it("shows a load error for triad history instead of an empty state", () => {
    enrollmentSessions.mockReturnValue({ sessions: [], loading: false, error: "boom" });
    renderPage();
    const history = screen.getByTestId("triad-history");
    expect(history).toHaveTextContent("Your triad sessions could not be loaded.");
    expect(history).not.toHaveTextContent("No triad sessions yet.");
  });
});
