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

// Shared module structure (useModuleWorkspace): canonical requirements,
// post-session deliverables and the booking goal gate.
vi.mock("@/hooks/journey/useModuleRequirements", () => ({
  useModuleRequirements: () => ({ state: null, loading: false, error: null }),
}));
vi.mock("@/hooks/sessions/usePostSessionDeliverables", () => ({
  useLearnerSessionDeliverables: () => ({ deliverables: [], loading: false, error: null }),
}));
vi.mock("@/hooks/journey/useModuleGoalsActions", () => ({
  useModuleGoalsActions: () => ({ actions: [], goals: [], loading: false, error: null }),
}));
vi.mock("@/components/goals/useBookingGoalGate", () => ({
  useBookingGoalGate: () => ({ gate: null, blocked: false, loading: false }),
}));

import "@/i18n/config";
import { MyMentorSection } from "../MyMentorSection";

beforeEach(() => {
  enrollmentContext.mockReturnValue({ selectedEnrollment: { id: "enrollment-1" }, loading: false });
  learnerCanonicalProgress.mockReturnValue({ progress: null, loading: false, error: null });
  learnerFeedback.mockReturnValue({ feedback: [], loading: false });
});

describe("MyMentorSection", () => {
  it("shows explicit empty states (no mentor, no sessions) when there is no mentoring session yet", () => {
    enrollmentSessions.mockReturnValue({ sessions: [], loading: false, error: null });
    render(<MemoryRouter><MyMentorSection /></MemoryRouter>);
    expect(screen.getByTestId("my-mentor")).toHaveTextContent("No mentoring session booked yet");
    expect(screen.getByTestId("mentoring-sessions")).toHaveTextContent("No mentoring sessions in this programme yet.");
    expect(screen.getByTestId("mentoring-preparation")).toHaveTextContent("Book a mentoring session to start preparing.");
  });

  it("quotes mentoring progress from the canonical row (2/2) and lists only mentoring sessions", () => {
    learnerCanonicalProgress.mockReturnValue({ progress: { mentoring_completed_units: 2, mentoring_required_units: 2 }, loading: false, error: null });
    enrollmentSessions.mockReturnValue({
      sessions: [
        { id: "mentoring-a", enrollmentId: "enrollment-1", type: "mentoring", title: "Review", startTime: "2026-03-01T09:00:00Z", status: "completed", counterpartName: "Minh Anh", sourceId: "a", sourceType: "mentoring_sessions" },
        { id: "coaching-c", enrollmentId: "enrollment-1", type: "coaching", title: "Coaching", startTime: "2026-03-02T09:00:00Z", status: "completed", sourceId: "c", sourceType: "sessions" },
      ],
      loading: false,
      error: null,
    });
    render(<MemoryRouter><MyMentorSection /></MemoryRouter>);
    expect(screen.getByTestId("my-mentor")).toHaveTextContent("2 / 2 sessions complete");
    const rows = screen.getAllByTestId("session-row");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveAttribute("href", "/mentoring/sessions/a");
  });

  it("quotes only learner-visible mentor feedback, never other modules' feedback", () => {
    learnerFeedback.mockReturnValue({
      feedback: [
        { id: "p", kind: "peer_competency", source: "peer_practice", note: "Peer quote", fromName: "Peer", submittedAt: "2026-03-03T00:00:00Z" },
        { id: "m", kind: "mentoring", source: "mentoring", overallNotes: "Mentor quote", fromName: "Minh Anh", submittedAt: "2026-03-02T00:00:00Z" },
      ],
      loading: false,
    });
    enrollmentSessions.mockReturnValue({ sessions: [], loading: false, error: null });
    render(<MemoryRouter><MyMentorSection /></MemoryRouter>);
    expect(screen.getByText(/Mentor quote/)).toBeInTheDocument();
    expect(screen.queryByText(/Peer quote/)).not.toBeInTheDocument();
  });

  it("shows the real mentor name from the actual booked session, not a sample name", () => {
    enrollmentSessions.mockReturnValue({
      sessions: [
        {
          id: "mentoring-s1",
          enrollmentId: "enrollment-1",
          type: "mentoring",
          title: "Practice Review",
          startTime: "2027-01-01T09:30:00Z",
          status: "confirmed",
          counterpartName: "Minh Anh",
          sourceId: "s1",
          sourceType: "mentoring_sessions",
        },
      ],
      loading: false,
    });
    render(<MemoryRouter><MyMentorSection /></MemoryRouter>);
    expect(screen.getByText("Minh Anh")).toBeInTheDocument();
    expect(screen.queryByText(/Nguyen Minh Anh, PCC/i)).not.toBeInTheDocument();
  });

  // Section 5: two historical enrollments with different mentor pools.
  describe("historical enrollment isolation", () => {
    const enrollmentASession = {
      id: "mentoring-a", enrollmentId: "enrollment-A", type: "mentoring", title: "Old review",
      startTime: "2025-03-01T09:00:00Z", status: "completed", counterpartName: "Mentor A",
      sourceId: "a", sourceType: "mentoring_sessions",
    };
    const enrollmentBSession = {
      id: "mentoring-b", enrollmentId: "enrollment-B", type: "mentoring", title: "New review",
      startTime: "2026-03-01T09:00:00Z", status: "completed", counterpartName: "Mentor B",
      sourceId: "b", sourceType: "mentoring_sessions",
    };

    it("shows the current enrollment's mentor, never the historical one", () => {
      enrollmentContext.mockReturnValue({ selectedEnrollment: { id: "enrollment-B" }, loading: false });
      // useEnrollmentSessions is enrollment-scoped, so only B's session arrives.
      enrollmentSessions.mockReturnValue({ sessions: [enrollmentBSession], loading: false, error: null });
      render(<MemoryRouter><MyMentorSection /></MemoryRouter>);
      expect(screen.getByTestId("my-mentor")).toHaveTextContent("Mentor B");
      expect(screen.getByTestId("my-mentor")).not.toHaveTextContent("Mentor A");
    });

    it("shows the historical enrollment's own mentor when that enrollment is selected", () => {
      enrollmentContext.mockReturnValue({ selectedEnrollment: { id: "enrollment-A" }, loading: false });
      enrollmentSessions.mockReturnValue({ sessions: [enrollmentASession], loading: false, error: null });
      render(<MemoryRouter><MyMentorSection /></MemoryRouter>);
      expect(screen.getByTestId("my-mentor")).toHaveTextContent("Mentor A");
      expect(screen.getByTestId("my-mentor")).not.toHaveTextContent("Mentor B");
    });

    it("requests sessions for the selected enrollment, not for the user", () => {
      enrollmentContext.mockReturnValue({ selectedEnrollment: { id: "enrollment-B" }, loading: false });
      enrollmentSessions.mockReturnValue({ sessions: [enrollmentBSession], loading: false, error: null });
      render(<MemoryRouter><MyMentorSection /></MemoryRouter>);
      // The enrollment id must appear in the call: a user-global fetch here is
      // what let another enrollment's mentor leak in.
      expect(JSON.stringify(enrollmentSessions.mock.calls)).toContain("enrollment-B");
    });

    it("falls back to a cohort-pool mentor name only when it is the sole mentor", () => {
      enrollmentContext.mockReturnValue({ selectedEnrollment: { id: "enrollment-B" }, loading: false });
      enrollmentSessions.mockReturnValue({ sessions: [], loading: false, error: null });
      // MentoringFindMentor passes this only when the pool holds exactly one
      // mentor; it comes from get_mentors_for_enrollment, never get_my_mentors.
      render(<MemoryRouter><MyMentorSection fallbackMentorName="Sole Cohort Mentor" /></MemoryRouter>);
      expect(screen.getByTestId("my-mentor")).toHaveTextContent("Sole Cohort Mentor");
    });
  });

});
