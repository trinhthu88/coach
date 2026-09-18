import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { canonicalExperience, canonicalJourney, canonicalProgress, ENROLLMENT_ID } from "@/test/fixtures/canonicalEnrollment";

const state = vi.hoisted(() => ({
  feedbackError: null as string | null,
  feedback: [] as unknown[],
  goals: [] as unknown[],
  ratings: {} as Record<string, unknown>,
  goalProgress: {} as Record<string, number | null>,
  canonicalCalls: [] as Array<string | undefined>,
}));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "learner-1" }, profile: { full_name: "Jamie Learner" }, role: "coachee" }),
}));
vi.mock("@/hooks/journey/useJourneyProgramme", () => ({
  useJourneyProgramme: () => ({ programme: { enrollmentId: "enrollment-seeded-partial" }, usage: null, loading: false, error: null }),
}));
vi.mock("@/hooks/useLearnerCanonicalProgress", () => ({
  useLearnerCanonicalProgress: (enrollmentId: string | undefined) => {
    state.canonicalCalls.push(enrollmentId);
    return { progress: canonicalProgress, modules: [], journey: canonicalJourney, experience: canonicalExperience, loading: false, error: null, retry: vi.fn() };
  },
  useLearnerCanonicalGoalProgress: () => ({ progressByGoal: state.goalProgress, loading: false, error: null }),
  LEARNER_ENGAGEMENT_QUERY_KEYS: [],
}));
vi.mock("@/hooks/journey/useJourneyGoals", () => ({
  useJourneyGoals: () => ({ goals: state.goals, milestones: [], loading: false, error: null, addGoal: vi.fn() }),
}));
vi.mock("@/hooks/journey/useJourneyRatings", () => ({
  useJourneyRatings: () => ({ ratings: state.ratings, sessionRatings: [], checkins: [], loading: false, error: null, saveRating: vi.fn() }),
}));
vi.mock("@/hooks/journey/useJourneySessions", () => ({
  useJourneySessions: () => ({ coachingSessions: [], peerSessions: [], loading: false, toggleAction: vi.fn() }),
}));
vi.mock("@/hooks/journey/useJourneyReflections", () => ({
  useJourneyReflections: () => ({ reflections: [], loading: false, addReflection: vi.fn(), deleteReflection: vi.fn() }),
}));
vi.mock("@/hooks/journey/useEnrollmentDevelopmentJourney", () => ({
  useEnrollmentDevelopmentJourney: () => ({ events: [], loading: false, error: null, partialFailure: false }),
}));
vi.mock("@/hooks/dashboard/useLearnerFeedback", () => ({
  useLearnerFeedback: () => ({ feedback: state.feedback, loading: false, error: state.feedbackError }),
}));
vi.mock("@/hooks/dashboard/useEnrollmentActionsSummary", () => ({
  useEnrollmentActionsSummary: () => ({
    actions: [], overdue: [], dueThisWeek: [], upcoming: [], completed: [],
    total: 0, openCount: 0, completedCount: 0, completionPct: null, loading: false, error: null,
  }),
}));
vi.mock("@/hooks/journey/usePracticeAnalytics", () => ({
  usePracticeAnalytics: () => ({ loading: false, entries: [], feedback: [], profilesById: {}, stats: null, competencyScores: [] }),
}));

import "@/i18n/config";
import i18n from "@/i18n/config";
import CoacheeJourney from "../CoacheeJourney";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/coachee/journey"]}>
      <CoacheeJourney />
    </MemoryRouter>
  );
}

describe("My Journey — consumes the shared Programme Journey", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    state.feedbackError = null;
    state.feedback = [];
    state.goals = [];
    state.ratings = {};
    state.goalProgress = {};
    state.canonicalCalls = [];
  });

  it("renders the shared full journey from the canonical learner source for the selected enrollment", () => {
    renderPage();
    const journey = screen.getByTestId("programme-journey");
    expect(journey).toHaveAttribute("data-viewer", "learner");
    expect(journey).toHaveAttribute("data-variant", "full");
    expect(state.canonicalCalls).toContain(ENROLLMENT_ID);
    const cards = screen.getAllByTestId("journey-checkpoint");
    expect(cards.map((c) => c.getAttribute("data-state"))).toEqual(["overdue", "overdue", "completed", "completed", "current", "upcoming"]);
    expect(within(cards[0]).getByText("0 / 1")).toBeInTheDocument();
    expect(within(cards[1]).getByText("0 / 2")).toBeInTheDocument();
    expect(within(cards[2]).getByText("3 / 3")).toBeInTheDocument();
    expect(screen.getByTestId("checkpoint-detail")).toBeInTheDocument();
  });

  it("exposes the deep-link anchors the Dashboard CTAs target", () => {
    const { container } = renderPage();
    for (const id of ["programme-journey", "goals", "feedback"]) {
      expect(container.querySelector(`#${id}`)).not.toBeNull();
    }
  });

  it("shows a feedback load failure as an error, not as 'no feedback yet'", () => {
    state.feedbackError = "PGRST200";
    renderPage();
    expect(screen.getByText(/Feedback could not be loaded because of a connection or server error/)).toBeInTheDocument();
  });

  it("uses the same programme header as the Dashboard and shows shared session notes with a link to the session", () => {
    state.feedback = [
      { kind: "session_note", id: "coaching-s1", source: "coaching", sessionId: "s1", topic: "Delegation", fromName: "Casey Coach", submittedAt: "2026-03-01T10:00:00Z", note: "Try the 3-question check-in." },
    ];
    renderPage();
    expect(screen.getByText("Leadership Accelerator · Spring cohort")).toBeInTheDocument();
    const item = screen.getByTestId("feedback-item");
    expect(within(item).getByText("Coach session note · Casey Coach")).toBeInTheDocument();
    expect(within(item).getByText("Try the 3-question check-in.")).toBeInTheDocument();
    expect(within(item).getByRole("link", { name: /Open session/ })).toHaveAttribute("href", "/sessions/s1");
  });

  it("renders each goal's progress from canonical_goal_progress", () => {
    state.goals = [{ id: "goal-1", title: "Lead one-to-ones", description: null, target_date: null, status: "active", created_at: "2026-01-02" }];
    state.ratings = { "goal-1": { goal_id: "goal-1", start_rating: 20, current_rating: 50, target_rating: 80 } };
    state.goalProgress = { "goal-1": 47.6 };
    const { container } = renderPage();
    const bar = container.querySelector("#goal-goal-1 [style*='width']") as HTMLElement;
    expect(bar.style.width).toBe("48%");
  });
});
