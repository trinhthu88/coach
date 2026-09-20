import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";

const enrollmentContext = vi.fn();
const learnerCanonicalProgress = vi.fn();
const enrollmentSessions = vi.fn();
const learnerFeedback = vi.fn();

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "learner-1" } }),
}));
vi.mock("@/hooks/useEnrollmentContext", () => ({
  useEnrollmentContext: (...args: unknown[]) => enrollmentContext(...args),
}));
vi.mock("@/hooks/useLearnerCanonicalProgress", () => ({
  useLearnerCanonicalProgress: (...args: unknown[]) => learnerCanonicalProgress(...args),
}));
vi.mock("@/hooks/journey/useEnrollmentSessions", () => ({
  useEnrollmentSessions: (...args: unknown[]) => enrollmentSessions(...args),
}));
vi.mock("@/hooks/dashboard/useLearnerFeedback", () => ({
  useLearnerFeedback: (...args: unknown[]) => learnerFeedback(...args),
}));

import "@/i18n/config";
import { MyPeerPracticeSection } from "../MyPeerPracticeSection";

beforeEach(() => {
  enrollmentContext.mockReturnValue({ selectedEnrollment: { id: "enrollment-1" }, loading: false });
  learnerCanonicalProgress.mockReturnValue({ progress: null });
  learnerFeedback.mockReturnValue({ feedback: [], loading: false });
});

describe("MyPeerPracticeSection", () => {
  it("shows an explicit empty history (not nothing) when there is no peer session yet", () => {
    enrollmentSessions.mockReturnValue({ sessions: [], loading: false, error: null });
    render(<MemoryRouter><MyPeerPracticeSection /></MemoryRouter>);
    expect(screen.getByText("Peer coaching sessions")).toBeInTheDocument();
    expect(screen.getByText("No peer practice sessions yet.")).toBeInTheDocument();
  });

  it("shows every peer session in history while module progress stays capped (2/2 with 4 records)", () => {
    learnerCanonicalProgress.mockReturnValue({ progress: { peer_completed_units: 2, peer_required_units: 2, programme_label: "P", cohort_label: "C" } });
    const row = (id: string, status: string, role: string, evidence: boolean, start: string) => ({
      id: `peer_coaching:coachee_peer_sessions:${id}`,
      enrollmentId: "enrollment-1",
      type: "peer_coaching",
      title: `Practice ${id}`,
      startTime: start,
      status,
      sourceId: id,
      sourceType: "coachee_peer_sessions",
      participantRole: role,
      isProgrammeEvidence: evidence,
    });
    enrollmentSessions.mockReturnValue({
      sessions: [
        row("r1", "completed", "receiver", true, "2026-02-02T08:00:00Z"),
        row("r2", "completed", "receiver", true, "2026-03-02T08:00:00Z"),
        row("g1", "completed", "provider", false, "2026-02-02T08:00:00Z"),
        row("g2", "confirmed", "provider", false, "2099-04-05T08:00:00Z"),
      ],
      loading: false,
      error: null,
    });
    render(<MemoryRouter><MyPeerPracticeSection /></MemoryRouter>);
    expect(screen.getByText(/4 sessions in your history · 2 count as programme evidence · Peer coaching 2\/2/)).toBeInTheDocument();
    const rows = screen.getAllByTestId("session-row");
    expect(rows).toHaveLength(4);
    // Every row opens the coachee peer-practice detail (not the coach-to-coach table).
    for (const link of screen.getAllByRole("link")) {
      expect(link.getAttribute("href")).toMatch(/\?type=coachee_peer$/);
    }
    expect(screen.getAllByTestId("programme-evidence")).toHaveLength(2);
  });

  it("shows a load error instead of an empty history when the history source fails", () => {
    enrollmentSessions.mockReturnValue({ sessions: [], loading: false, error: "boom" });
    render(<MemoryRouter><MyPeerPracticeSection /></MemoryRouter>);
    // Every stage list reports the failure rather than rendering as empty:
    // "no sessions" and "we could not load your sessions" are different facts.
    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(3);
    for (const alert of alerts) {
      expect(alert).toHaveTextContent("Your peer practice sessions could not be loaded.");
    }
    expect(screen.queryByText("No peer practice sessions yet.")).not.toBeInTheDocument();
  });

  it("splits one canonical list into the stage each session is actually in", () => {
    learnerCanonicalProgress.mockReturnValue({ progress: { peer_completed_units: 1, peer_required_units: 2, programme_label: "P", cohort_label: "C" } });
    const row = (id: string, status: string, start: string) => ({
      id: `peer_coaching:coachee_peer_sessions:${id}`,
      enrollmentId: "enrollment-1",
      type: "peer_coaching",
      title: `Practice ${id}`,
      startTime: start,
      status,
      sourceId: id,
      sourceType: "coachee_peer_sessions",
      participantRole: "receiver",
      isProgrammeEvidence: status === "completed",
    });
    enrollmentSessions.mockReturnValue({
      sessions: [
        row("p1", "pending_coach_approval", "2099-05-01T08:00:00Z"),
        row("u1", "confirmed", "2099-04-05T08:00:00Z"),
        row("d1", "completed", "2026-02-02T08:00:00Z"),
        // Confirmed but already past: waiting to be marked complete, which is
        // not "upcoming".
        row("x1", "confirmed", "2026-01-02T08:00:00Z"),
        row("c1", "cancelled", "2026-01-03T08:00:00Z"),
      ],
      loading: false,
      error: null,
    });
    render(<MemoryRouter><MyPeerPracticeSection /></MemoryRouter>);
    const within_ = (id: string) => screen.getByTestId(id).querySelectorAll('[data-testid="session-row"]');
    expect(within_("peer-pending")).toHaveLength(1);
    expect(within_("peer-upcoming")).toHaveLength(1);
    expect(within_("peer-past")).toHaveLength(3);
    // Every session appears exactly once across the three lists.
    expect(screen.getAllByTestId("session-row")).toHaveLength(5);
  });
});
