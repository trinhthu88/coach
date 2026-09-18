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
import { MyMentorSection } from "../MyMentorSection";

beforeEach(() => {
  enrollmentContext.mockReturnValue({ selectedEnrollment: { id: "enrollment-1" }, loading: false });
  learnerCanonicalProgress.mockReturnValue({ progress: null });
  learnerFeedback.mockReturnValue({ feedback: [], loading: false });
});

describe("MyMentorSection", () => {
  it("renders nothing when there is no mentoring session yet — Find a Mentor list remains the empty state", () => {
    enrollmentSessions.mockReturnValue({ sessions: [], loading: false });
    const { container } = render(<MemoryRouter><MyMentorSection /></MemoryRouter>);
    expect(container).toBeEmptyDOMElement();
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
});
