import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const enrollmentContext = vi.fn();
const journeyGoals = vi.fn();
const journeyRatings = vi.fn();
const learnerCanonicalProgress = vi.fn();
const actionsSummary = vi.fn();

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "learner-1" }, role: "coachee" }),
}));
vi.mock("@/hooks/useEnrollmentContext", () => ({
  useEnrollmentContext: (...args: unknown[]) => enrollmentContext(...args),
}));
vi.mock("@/hooks/journey/useJourneyGoals", () => ({
  useJourneyGoals: (...args: unknown[]) => journeyGoals(...args),
}));
vi.mock("@/hooks/journey/useJourneyRatings", () => ({
  useJourneyRatings: (...args: unknown[]) => journeyRatings(...args),
}));
vi.mock("@/hooks/useLearnerCanonicalProgress", () => ({
  useLearnerCanonicalProgress: (...args: unknown[]) => learnerCanonicalProgress(...args),
}));
vi.mock("@/hooks/dashboard/useEnrollmentActionsSummary", () => ({
  useEnrollmentActionsSummary: (...args: unknown[]) => actionsSummary(...args),
}));

import "@/i18n/config";
import { MyGoalCard } from "../MyGoalCard";

const emptyExperience = { weeklyParticipation: [], learningBreakdown: [], coachingUtilisation: null };
const emptyActions = {
  actions: [], overdue: [], dueThisWeek: [], upcoming: [], completed: [],
  total: 0, openCount: 0, completedCount: 0, completionPct: null, loading: false, error: null,
};

describe("MyGoalCard", () => {
  beforeEach(() => {
    enrollmentContext.mockReturnValue({ selectedEnrollment: { id: "enrollment-1" }, loading: false });
    journeyRatings.mockReturnValue({ ratings: {}, loading: false });
    learnerCanonicalProgress.mockReturnValue({ journey: [], experience: emptyExperience, loading: false });
    actionsSummary.mockReturnValue(emptyActions);
  });

  it("shows an honest empty state instead of a fabricated goal when none exist", () => {
    journeyGoals.mockReturnValue({ goals: [], loading: false, error: null });
    render(<MemoryRouter><MyGoalCard /></MemoryRouter>);
    expect(screen.getByText("No goals have been created for this programme yet.")).toBeInTheDocument();
  });

  it("renders the active goal's title and canonical rating-based progress, not a milestone ratio", () => {
    journeyGoals.mockReturnValue({
      goals: [{ id: "g1", title: "Improve delegation", description: null, target_date: null, status: "active", created_at: "2026-01-01" }],
      loading: false,
      error: null,
    });
    journeyRatings.mockReturnValue({
      ratings: { g1: { goal_id: "g1", start_rating: 39, current_rating: 56, target_rating: 85 } },
      loading: false,
    });
    render(<MemoryRouter><MyGoalCard /></MemoryRouter>);
    expect(screen.getByText("Improve delegation")).toBeInTheDocument();
    expect(screen.getByText("37%")).toBeInTheDocument();
  });

  it("highlights overdue actions distinctly from the open/completed summary", () => {
    journeyGoals.mockReturnValue({ goals: [], loading: false, error: null });
    actionsSummary.mockReturnValue({
      ...emptyActions,
      total: 3,
      openCount: 2,
      completedCount: 1,
      overdue: [{ id: "a1", title: "Overdue action", description: null, status: "open", due_date: "2026-01-01", goal_id: null, milestone_id: null, completed_at: null }],
    });
    render(<MemoryRouter><MyGoalCard /></MemoryRouter>);
    expect(screen.getByText(/1 completed · 2 open/)).toBeInTheDocument();
    expect(screen.getByText(/1 overdue/)).toBeInTheDocument();
  });
});
