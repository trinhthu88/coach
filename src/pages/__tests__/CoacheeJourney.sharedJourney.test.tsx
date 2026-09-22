import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { canonicalExperience, canonicalJourney, canonicalProgress, ENROLLMENT_ID } from "@/test/fixtures/canonicalEnrollment";
import { reflectionFeedFixture } from "@/test/fixtures/reflectionFeed";

// Schedule-mismatch state (cohort_programme_schedule_state) — aligned here.
vi.mock("@/hooks/useCanonicalScheduleState", () => ({
  useCanonicalScheduleState: () => ({ rows: [], mismatches: [], loading: false, error: null }),
}));


const state = vi.hoisted(() => ({
  active: {
    enrollmentId: "enrollment-seeded-partial" as string | null,
    loading: false,
    error: null as string | null,
    details: { organization_name: "Clariva Demo Organization" } as { organization_name: string } | null,
  },
  feedbackError: null as string | null,
  feedback: [] as unknown[],
  goals: [] as unknown[],
  ratings: {} as Record<string, unknown>,
  goalProgress: {} as Record<string, number | null>,
  canonicalCalls: [] as Array<string | undefined>,
  reflections: [] as unknown[],
  reflectionsError: null as string | null,
  reflectionFeedCalls: [] as Array<string | undefined>,
  sessions: [] as unknown[],
}));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "learner-1" }, profile: { full_name: "Jamie Learner" }, role: "coachee" }),
}));
// The ONE learner enrollment context (the same one the Dashboard reads).
vi.mock("@/hooks/useActiveEnrollment", () => ({
  useActiveEnrollmentDetails: () => state.active,
  useActiveEnrollment: () => state.active,
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
vi.mock("@/hooks/journey/useEnrollmentSessions", () => ({
  useEnrollmentSessions: () => ({ sessions: [], loading: false, error: null }),
}));
// Outstanding post-session work: the canonical learner_session_deliverables rows.
vi.mock("@/hooks/sessions/usePostSessionDeliverables", () => ({
  useLearnerSessionDeliverables: () => ({ deliverables: state.sessions, loading: false, error: null }),
}));
vi.mock("@/hooks/journey/useEnrollmentDevelopmentJourney", () => ({
  useEnrollmentDevelopmentJourney: () => ({ events: [], loading: false, error: null, partialFailure: false }),
}));
vi.mock("@/hooks/journey/useLearnerReflectionFeed", () => ({
  LEARNER_REFLECTION_FEED_KEY: "learner-reflection-feed",
  useLearnerReflectionFeed: (enrollmentId: string | undefined) => {
    state.reflectionFeedCalls.push(enrollmentId);
    return { reflections: state.reflections, loading: false, error: state.reflectionsError };
  },
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
    state.reflections = [];
    state.reflectionsError = null;
    state.reflectionFeedCalls = [];
    state.sessions = [];
    state.active = { enrollmentId: ENROLLMENT_ID, loading: false, error: null, details: { organization_name: "Clariva Demo Organization" } };
  });

  it("reads the same active enrollment every learner surface reads, and shows its organisation", () => {
    renderPage();
    expect(state.canonicalCalls.every((id) => id === ENROLLMENT_ID)).toBe(true);
    expect(state.reflectionFeedCalls.every((id) => id === ENROLLMENT_ID)).toBe(true);
    expect(screen.getByTestId("journey-header")).toHaveTextContent("Clariva Demo Organization");
  });

  it("an enrollment resolution failure is shown as an error, never as an empty journey", () => {
    state.active = { enrollmentId: null, loading: false, error: "Multiple ongoing programme enrollments require an explicit selection.", details: null };
    renderPage();
    expect(screen.getByTestId("journey-enrollment-state")).toHaveTextContent(/could not be loaded: Multiple ongoing/);
    expect(screen.queryByTestId("programme-journey")).toBeNull();
    expect(screen.queryByText(/Nothing has happened/i)).toBeNull();
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

  it("shows the design header with the canonical programme · cohort and shows shared session notes with a link to the session", () => {
    state.feedback = [
      { kind: "session_note", id: "coaching-s1", source: "coaching", sessionId: "s1", topic: "Delegation", fromName: "Casey Coach", submittedAt: "2026-03-01T10:00:00Z", note: "Try the 3-question check-in." },
    ];
    renderPage();
    expect(screen.getByTestId("journey-header")).toHaveTextContent("Leadership Accelerator · Spring cohort");
    const item = screen.getByTestId("feedback-item");
    expect(within(item).getByText("Coach session note · Casey Coach")).toBeInTheDocument();
    expect(within(item).getByText(/Try the 3-question check-in\./)).toBeInTheDocument();
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

  it("renders the canonical reflection feed with each item's source, date, rating change and link", () => {
    state.reflections = reflectionFeedFixture;
    renderPage();
    expect(state.reflectionFeedCalls).toContain(ENROLLMENT_ID);
    const list = screen.getByTestId("journey-reflections");
    const items = within(list).getAllByTestId("reflection-item");
    expect(items.map((i) => i.getAttribute("data-source"))).toEqual([
      "journey_reflection",
      "goal_checkin",
      "triad_reflection",
      "mentoring_session_reflection",
      "peer_session_reflection",
      "training_reflection",
      "coaching_session_reflection",
    ]);
    for (const label of [
      "Coaching · Session reflection",
      "Peer coaching · Session reflection",
      "Mentoring · Session reflection",
      "Triad · Session reflection",
      "Goal · Check-in",
      "Training / Learning · Reflection prompt",
      "Journey · Personal reflection",
    ]) {
      expect(within(list).getByText(label)).toBeInTheDocument();
    }
    const checkin = items[1];
    expect(within(checkin).getByText("Lead weekly one-to-ones")).toBeInTheDocument();
    expect(within(checkin).getByText("Rating 7 → 8")).toBeInTheDocument();
    expect(within(checkin).getByText("“Goal check-in: I noticed that I delegate more.”")).toBeInTheDocument();
    expect(within(checkin).getByRole("link")).toHaveAttribute("href", "/sessions/s2");
    expect(within(items[2]).getByText("As coach · What did I learn?")).toBeInTheDocument();
    expect(within(items[3]).getByRole("link")).toHaveAttribute("href", "/mentoring/sessions/m1");
    expect(within(items[4]).getByRole("link")).toHaveAttribute("href", "/sessions/p1?type=coachee_peer");
    expect(within(items[5]).getByText("What did you try?")).toBeInTheDocument();
    expect(within(items[0]).getByText("Private")).toBeInTheDocument();
    expect(items[0]).toHaveTextContent("only you can see this");
    // Only explicit journey reflections are deletable from here.
    expect(within(list).getAllByRole("button", { name: "Delete reflection" })).toHaveLength(1);
  });

  it("lists completed sessions with outstanding deliverables from the canonical rows, linked to where they are completed", () => {
    const base = {
      participantRole: null, counterpartNames: [], requirementUnitNumber: null,
      hasGoalCheckin: true, goalCheckinRequired: true, hasAction: true, hasSatisfaction: true, satisfactionRating: 4,
    };
    state.sessions = [
      { ...base, module: "mentoring", sourceTable: "mentoring_sessions", sessionId: "m-1", title: "Delegation", startTime: "2026-05-02T09:00:00Z",
        hasReflection: false, hasSatisfaction: false, satisfactionRating: null, deliverablesComplete: false },
      { ...base, module: "coaching", sourceTable: "sessions", sessionId: "c-1", title: "All done", startTime: "2026-04-02T09:00:00Z",
        hasReflection: true, deliverablesComplete: true },
    ];
    renderPage();
    const pending = screen.getByTestId("pending-reflections");
    expect(pending).toHaveTextContent(/1 session with follow-up to complete/i);
    const link = within(pending).getByRole("link", { name: /Mentoring session · Delegation/ });
    expect(link).toHaveAttribute("href", "/mentoring/sessions/m-1");
    expect(within(link).getByTestId("pending-deliverable-items")).toHaveTextContent("Reflection · Rating");
  });

  it("shows a reflection load failure as an error, not as an empty reflection list", () => {
    state.reflectionsError = "boom";
    renderPage();
    expect(within(screen.getByTestId("journey-reflections")).getByRole("alert")).toHaveTextContent("Your reflections could not be loaded.");
  });
});
