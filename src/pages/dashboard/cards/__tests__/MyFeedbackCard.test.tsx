import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const learnerFeedback = vi.fn();
const enrollmentContext = vi.fn();

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "learner-1" } }),
}));
vi.mock("@/hooks/useEnrollmentContext", () => ({
  useEnrollmentContext: (...args: unknown[]) => enrollmentContext(...args),
}));
vi.mock("@/hooks/dashboard/useLearnerFeedback", () => ({
  useLearnerFeedback: (...args: unknown[]) => learnerFeedback(...args),
}));

import "@/i18n/config";
import { MyFeedbackCard } from "../MyFeedbackCard";

describe("MyFeedbackCard", () => {
  beforeEach(() => {
    enrollmentContext.mockReturnValue({ selectedEnrollment: { id: "enrollment-1" }, loading: false });
  });

  it("shows an explicit empty state, not a fabricated 0, when there is no learner-visible feedback", () => {
    learnerFeedback.mockReturnValue({ feedback: [], loading: false, error: null });
    render(<MyFeedbackCard />);
    expect(screen.getByText("No learner-visible feedback yet.")).toBeInTheDocument();
  });

  it("renders mentoring feedback content the hook returned, and nothing else", () => {
    learnerFeedback.mockReturnValue({
      feedback: [
        {
          kind: "mentoring",
          id: "f1",
          fromName: "Casey Mentor",
          submittedAt: "2026-06-01T00:00:00Z",
          overallNotes: "Great progress on delegation this month.",
          competencies: [],
        },
      ],
      loading: false,
      error: null,
    });
    render(<MyFeedbackCard />);
    expect(screen.getByText("Mentor feedback · Casey Mentor")).toBeInTheDocument();
    expect(screen.getByText("Great progress on delegation this month.")).toBeInTheDocument();
  });

  it("never renders coach-private fields such as quality_rating or flag_notes even if present in the feedback item shape", () => {
    // coach_session_feedback fields must never reach this component's props
    // at all — this asserts the render surface has no path to display them
    // even if a caller accidentally passed one through.
    learnerFeedback.mockReturnValue({
      feedback: [
        {
          kind: "mentoring",
          id: "f1",
          fromName: "Casey Mentor",
          submittedAt: "2026-06-01T00:00:00Z",
          overallNotes: "Notes",
          competencies: [],
          // Simulating an accidental private-field leak from the caller —
          // this mock is intentionally untyped, matching the loose shape a
          // real bug would actually produce.
          quality_rating: 2,
          flag_notes: "confidential coach note",
        },
      ],
      loading: false,
      error: null,
    });
    render(<MyFeedbackCard />);
    expect(screen.queryByText(/confidential coach note/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/quality_rating/i)).not.toBeInTheDocument();
  });

  // Section 11 / 66 regression: feedback must be scoped to the *selected*
  // enrollment, not just the learner — otherwise a re-enrolled learner would
  // see feedback belonging to a different programme enrollment mixed in.
  it("passes the selected enrollment id through to useLearnerFeedback", () => {
    learnerFeedback.mockReturnValue({ feedback: [], loading: false, error: null });
    enrollmentContext.mockReturnValue({ selectedEnrollment: { id: "enrollment-42" }, loading: false });
    render(<MyFeedbackCard />);
    expect(learnerFeedback).toHaveBeenCalledWith("learner-1", "enrollment-42");
  });
});
