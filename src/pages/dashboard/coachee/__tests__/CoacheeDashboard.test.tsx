import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "learner-1" }, profile: { full_name: "Jamie Learner" }, role: "coachee" }),
}));
vi.mock("@/hooks/useEnrollmentContext", () => ({
  useEnrollmentContext: () => ({ selectedEnrollment: null, loading: false }),
}));
vi.mock("@/hooks/useLearnerCanonicalProgress", () => ({
  useLearnerCanonicalProgress: () => ({
    progress: null,
    modules: [],
    journey: [],
    experience: { weeklyParticipation: [], learningBreakdown: [], coachingUtilisation: null },
    loading: false,
  }),
}));
vi.mock("@/hooks/dashboard/useEnrollmentActionsSummary", () => ({
  useEnrollmentActionsSummary: () => ({
    actions: [], overdue: [], dueThisWeek: [], upcoming: [], completed: [],
    total: 0, openCount: 0, completedCount: 0, completionPct: null, loading: false, error: null,
  }),
}));
vi.mock("@/hooks/journey/useJourneyGoals", () => ({
  useJourneyGoals: () => ({ goals: [], milestones: [], loading: false, error: null }),
}));
vi.mock("@/hooks/journey/useJourneyRatings", () => ({
  useJourneyRatings: () => ({ ratings: {}, loading: false }),
}));
vi.mock("@/hooks/dashboard/useLearnerFeedback", () => ({
  useLearnerFeedback: () => ({ feedback: [], loading: false, error: null }),
}));
vi.mock("@/hooks/journey/useEnrollmentSessions", () => ({
  useEnrollmentSessions: () => ({ sessions: [], loading: false, error: null }),
}));
vi.mock("@/hooks/journey/useEnrollmentDevelopmentJourney", () => ({
  useEnrollmentDevelopmentJourney: () => ({ events: [], loading: false, error: null }),
}));

import "@/i18n/config";
import { CoacheeDashboard } from "../CoacheeDashboard";

/**
 * Full-page smoke test with every canonical source empty — the "no data
 * anywhere" case every dashboard section must render honestly (an explicit
 * empty state) rather than crash or silently fabricate content to look
 * populated. Per-hook behavior is covered by each card's own unit tests.
 */
describe("CoacheeDashboard — fully empty canonical data", () => {
  it("renders every section's explicit empty state without crashing or inventing sample content", () => {
    render(
      <MemoryRouter>
        <CoacheeDashboard />
      </MemoryRouter>
    );

    expect(screen.getByText("Your programme details will appear here once you have an active enrollment.")).toBeInTheDocument();
    expect(screen.getByText("Nothing due right now.")).toBeInTheDocument();
    expect(screen.getByText("No programme checkpoints are configured for this enrollment yet.")).toBeInTheDocument();
    expect(screen.getByText("No modules are configured for this enrollment yet.")).toBeInTheDocument();
    expect(screen.getByText("No feedback yet.")).toBeInTheDocument();
    expect(screen.getByText("No upcoming session booked.")).toBeInTheDocument();

    // None of the prototype's illustrative sample values.
    expect(screen.queryByText(/Emerging Leaders/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Mai Nguyen/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Anna Fan/i)).not.toBeInTheDocument();
    expect(screen.queryByText("42%")).not.toBeInTheDocument();
  });
});
