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
  it("renders nothing when there is no peer session yet", () => {
    enrollmentSessions.mockReturnValue({ sessions: [], loading: false });
    const { container } = render(<MemoryRouter><MyPeerPracticeSection /></MemoryRouter>);
    expect(container).toBeEmptyDOMElement();
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
