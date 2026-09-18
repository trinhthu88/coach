import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "learner-1" } }) }));
vi.mock("@/hooks/useEnrollmentContext", () => ({
  useEnrollmentContext: () => ({ selectedEnrollment: { id: "enrollment-1" }, loading: false }),
}));
vi.mock("@/hooks/triads/useMyTriads", () => ({
  // No admin-configured round is open (the reported case).
  useMyTriads: () => ({ rounds: [], loading: false, error: false, refetch: vi.fn() }),
}));
vi.mock("@/hooks/useLearnerCanonicalProgress", () => ({
  useLearnerCanonicalProgress: () => ({
    progress: { triad_completed_units: 1, triad_required_units: 2, programme_label: "Emerging Leaders", cohort_label: "Cohort C" },
  }),
}));
vi.mock("@/hooks/journey/useEnrollmentSessions", () => ({
  useEnrollmentSessions: () => ({
    sessions: [
      { id: "k1", enrollmentId: "enrollment-1", type: "triad", title: "Round 1", startTime: "2026-02-16T03:00:00Z", status: "completed", sourceId: "t1", sourceType: "triad_sessions", isProgrammeEvidence: true, participantRole: "coach" },
      { id: "k2", enrollmentId: "enrollment-1", type: "triad", title: "Round 1", startTime: "2026-04-20T03:00:00Z", status: "confirmed", sourceId: "t2", sourceType: "triad_sessions", isProgrammeEvidence: false, participantRole: "coach" },
    ],
    loading: false,
    error: null,
  }),
}));

import "@/i18n/config";
import TriadsPage from "../TriadsPage";

describe("TriadsPage", () => {
  it("says no round is open without hiding the learner's existing triad sessions", () => {
    render(
      <MemoryRouter>
        <TriadsPage />
      </MemoryRouter>
    );
    const current = screen.getByTestId("triad-current-rounds");
    expect(within(current).getByText("No triad round is open right now")).toBeInTheDocument();

    const history = screen.getByTestId("triad-history");
    expect(within(history).getByText("Triads programme progress: 1/2 completed")).toBeInTheDocument();
    const rows = within(history).getAllByTestId("session-row");
    expect(rows.map((r) => r.getAttribute("data-status"))).toEqual(["completed", "confirmed"]);
    expect(within(history).getAllByTestId("programme-evidence")).toHaveLength(1);
    expect(within(history).getAllByRole("link").map((l) => l.getAttribute("href"))).toEqual(["/triads/t1", "/triads/t2"]);
  });
});
