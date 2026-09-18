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
    expect(screen.getByText("My peer practice sessions")).toBeInTheDocument();
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
    expect(screen.getByRole("alert")).toHaveTextContent("Your peer practice sessions could not be loaded.");
    expect(screen.queryByText("No peer practice sessions yet.")).not.toBeInTheDocument();
  });

  it("shows only real received peer competency feedback, not mentoring feedback or sample quotes", () => {
    enrollmentSessions.mockReturnValue({
      sessions: [
        {
          id: "peer-s1",
          enrollmentId: "enrollment-1",
          type: "peer_coaching",
          title: "Practice Session 1",
          startTime: "2026-09-10T00:00:00Z",
          status: "completed",
          counterpartName: "Linh Tran",
          sourceId: "s1",
          sourceType: "peer_sessions",
        },
      ],
      loading: false,
    });
    learnerFeedback.mockReturnValue({
      feedback: [
        { kind: "peer_competency", id: "f1", fromName: "Linh Tran", submittedAt: "2026-09-10T00:00:00Z", note: "Strong listening.", scores: [] },
        { kind: "mentoring", id: "f2", fromName: "Minh Anh", submittedAt: "2026-09-11T00:00:00Z", overallNotes: "Mentoring-only note", competencies: [] },
      ],
      loading: false,
    });
    render(<MemoryRouter><MyPeerPracticeSection /></MemoryRouter>);
    expect(screen.getByText("Strong listening.")).toBeInTheDocument();
    expect(screen.queryByText("Mentoring-only note")).not.toBeInTheDocument();
  });
});
