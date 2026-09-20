import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {

  canonicalEngagement,
  canonicalExperience,
  canonicalJourney,
  canonicalProgress,
  ENROLLMENT_ID,
  sponsorLeaderRow,
} from "@/test/fixtures/canonicalEnrollment";

const state = vi.hoisted(() => ({
  canonical: {} as Record<string, unknown>,
  engagement: {} as Record<string, unknown>,
  goalProgress: {} as Record<string, unknown>,
  goals: {} as Record<string, unknown>,
  ratings: {} as Record<string, unknown>,
  actions: {} as Record<string, unknown>,
  feedback: {} as Record<string, unknown>,
  development: {} as Record<string, unknown>,
  sessions: {} as Record<string, unknown>,
  reflections: {} as Record<string, unknown>,
  reflectionFeedCalls: [] as Array<string | undefined>,
  learnerHookCalls: [] as string[],
}));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "learner-1" }, profile: { full_name: "Jamie Learner" }, role: "coachee" }),
}));
vi.mock("@/hooks/useEnrollmentContext", () => ({
  useEnrollmentContext: () => ({ selectedEnrollment: { id: "enrollment-seeded-partial" }, loading: false }),
}));
vi.mock("@/hooks/useLearnerCanonicalProgress", () => ({
  useLearnerCanonicalProgress: () => {
    state.learnerHookCalls.push("progress");
    return state.canonical;
  },
  useLearnerCanonicalEngagement: () => {
    state.learnerHookCalls.push("engagement");
    return state.engagement;
  },
  useLearnerCanonicalGoalProgress: () => {
    state.learnerHookCalls.push("goalProgress");
    return state.goalProgress;
  },
}));
vi.mock("@/hooks/journey/useJourneyGoals", () => ({
  useJourneyGoals: () => {
    state.learnerHookCalls.push("goals");
    return state.goals;
  },
}));
vi.mock("@/hooks/journey/useJourneyRatings", () => ({
  useJourneyRatings: () => {
    state.learnerHookCalls.push("ratings");
    return state.ratings;
  },
}));
vi.mock("@/hooks/dashboard/useEnrollmentActionsSummary", () => ({
  useEnrollmentActionsSummary: () => {
    state.learnerHookCalls.push("actions");
    return state.actions;
  },
}));
vi.mock("@/hooks/dashboard/useLearnerFeedback", () => ({
  useLearnerFeedback: () => {
    state.learnerHookCalls.push("feedback");
    return state.feedback;
  },
}));
vi.mock("@/hooks/journey/useEnrollmentDevelopmentJourney", () => ({
  useEnrollmentDevelopmentJourney: () => {
    state.learnerHookCalls.push("development");
    return state.development;
  },
}));
vi.mock("@/hooks/journey/useLearnerReflectionFeed", () => ({
  LEARNER_REFLECTION_FEED_KEY: "learner-reflection-feed",
  useLearnerReflectionFeed: (enrollmentId: string | undefined) => {
    state.learnerHookCalls.push("reflections");
    state.reflectionFeedCalls.push(enrollmentId);
    return state.reflections;
  },
}));
vi.mock("@/hooks/journey/useEnrollmentSessions", () => ({
  useEnrollmentSessions: () => state.sessions,
}));

// Schedule-mismatch state (cohort_programme_schedule_state) — aligned here.
vi.mock("@/hooks/useCanonicalScheduleState", () => ({
  useCanonicalScheduleState: () => ({ rows: [], mismatches: [], loading: false, error: null }),
}));

import "@/i18n/config";
import i18n from "@/i18n/config";
import { CoacheeDashboard } from "../CoacheeDashboard";
import { SponsorLeaderProfile } from "@/pages/sponsor/SponsorLeaderDrawer";
import { LearnerProgrammeJourney } from "@/components/programme/LearnerProgrammeJourney";

const PRIVATE_GOAL = "Lead weekly one-to-ones with confidence";
const PRIVATE_MILESTONE = "Draft one-to-one agenda template";
const PRIVATE_ACTION = "Ask two reports for agenda input";
const PRIVATE_CHECKIN_NOTE = "Felt calmer in Tuesday's one-to-one";
const MENTOR_FEEDBACK = "You listen well — now try summarising before advising.";
const PRIVATE_REFLECTION = "I avoid hard conversations when tired.";

function seedPopulated() {
  state.canonical = {
    progress: canonicalProgress,
    modules: [],
    journey: canonicalJourney,
    experience: canonicalExperience,
    loading: false,
    error: null,
    retry: vi.fn(),
  };
  state.engagement = { engagement: canonicalEngagement, loading: false, error: null };
  state.goalProgress = { progressByGoal: { "goal-1": 50, "goal-2": 60 }, loading: false, error: null };
  state.goals = {
    goals: [
      { id: "goal-1", title: PRIVATE_GOAL, description: "Every report leaves with one agreed next step", target_date: "2026-05-01", status: "active", created_at: "2026-01-02" },
      { id: "goal-2", title: "Delegate the monthly report", description: null, target_date: null, status: "active", created_at: "2026-01-03" },
    ],
    milestones: [
      { id: "m-1", goal_id: "goal-1", title: PRIVATE_MILESTONE, target_date: "2026-02-01", is_done: true, done_at: "2026-01-20" },
      { id: "m-2", goal_id: "goal-1", title: "Run three structured one-to-ones", target_date: "2026-03-01", is_done: false, done_at: null },
    ],
    loading: false,
    error: null,
  };
  state.ratings = {
    ratings: {
      "goal-1": { goal_id: "goal-1", start_rating: 20, current_rating: 50, target_rating: 80 },
      "goal-2": { goal_id: "goal-2", start_rating: 10, current_rating: 40, target_rating: 60 },
    },
    checkins: [
      { id: "c-1", goal_id: "goal-1", previous_rating: 35, new_rating: 50, note: PRIVATE_CHECKIN_NOTE, created_at: "2026-03-01T10:00:00Z" },
    ],
    loading: false,
    error: null,
  };
  const overdueAction = { id: "a-1", title: PRIVATE_ACTION, description: null, status: "open", due_date: "2026-02-01", goal_id: "goal-1", milestone_id: null, completed_at: null };
  state.actions = {
    actions: [
      overdueAction,
      { id: "a-2", title: "Book the delegation conversation", description: null, status: "in_progress", due_date: "2099-01-01", goal_id: "goal-2", milestone_id: null, completed_at: null },
      { id: "a-3", title: "Share one-to-one template", description: null, status: "completed", due_date: "2026-01-15", goal_id: "goal-1", milestone_id: null, completed_at: "2026-01-14" },
    ],
    overdue: [overdueAction],
    dueThisWeek: [],
    upcoming: [],
    completed: [],
    total: 3,
    openCount: 2,
    completedCount: 1,
    completionPct: 33,
    loading: false,
    error: null,
  };
  state.feedback = {
    feedback: [{ kind: "mentoring", id: "f-1", fromName: "Morgan Mentor", submittedAt: "2026-03-03T10:00:00Z", overallNotes: MENTOR_FEEDBACK, competencies: [] }],
    loading: false,
    error: null,
  };
  state.development = {
    events: [
      { id: "private-reflection-r1", enrollmentId: ENROLLMENT_ID, occurredAt: "2026-03-04T09:00:00Z", type: "reflection", subtype: "private_reflection", title: "Private reflection", summary: PRIVATE_REFLECTION, sourceId: "r1", sourceType: "coachee_reflections" },
      { id: "coaching-s1", enrollmentId: ENROLLMENT_ID, occurredAt: "2026-02-20T09:00:00Z", type: "coaching", subtype: "session_completed", title: "Coaching session completed", summary: "Delegation", sourceId: "s1", sourceType: "sessions" },
    ],
    loading: false,
    error: null,
    partialFailure: false,
  };
  state.sessions = { sessions: [], loading: false, error: null };
  state.reflections = {
    reflections: [
      { key: "journey_reflection:r1", sourceType: "journey_reflection", sourceTable: "coachee_reflections", sourceId: "r1", module: null, occurredAt: "2026-03-04T09:00:00Z", title: null, body: PRIVATE_REFLECTION, details: {}, rating: null, previousRating: null, linkedSessionTable: null, linkedSessionId: null, linkedGoalId: null, linkedActivityId: null, isPrivate: true },
    ],
    loading: false,
    error: null,
  };
  state.reflectionFeedCalls = [];
}

function renderDashboard() {
  return render(
    <MemoryRouter>
      <CoacheeDashboard />
    </MemoryRouter>
  );
}

function renderSponsor() {
  return render(
    <MemoryRouter>
      <SponsorLeaderProfile leader={sponsorLeaderRow} journey={canonicalJourney} experience={canonicalExperience} onBack={() => undefined} />
    </MemoryRouter>
  );
}

function moduleRatios(container: HTMLElement) {
  return ["coaching", "training", "peer", "mentoring", "triads"].map(
    (key) => `${key} ${within(container).getByTestId(`module-${key}`).querySelector("div > span:nth-child(2)")?.textContent}`
  );
}
function checkpoints(container: HTMLElement) {
  return within(container)
    .getAllByTestId("journey-checkpoint")
    .map((el) => `${el.getAttribute("data-state")}|${el.textContent}`);
}

describe("Learner Dashboard — canonical programme profile", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    state.learnerHookCalls = [];
    seedPopulated();
  });

  it("renders the canonical KPI values in the Sponsor Leader Detail order", () => {
    renderDashboard();
    const kpis = screen.getByTestId("programme-kpis");
    expect(within(kpis).getByText("88%")).toBeInTheDocument(); // 87.5% overall completion
    expect(within(kpis).getByText("14 / 16")).toBeInTheDocument();
    expect(within(kpis).getByText("55%")).toBeInTheDocument(); // canonical goal progress
    expect(within(kpis).getByText("4.5")).toBeInTheDocument(); // programme experience
    expect(screen.getByText("Leadership Accelerator · Spring cohort")).toBeInTheDocument();
    expect(screen.getByText("4 of 4 sessions")).toBeInTheDocument();
    expect(within(screen.getByTestId("coaching-utilisation")).getByText("4/4")).toBeInTheDocument();
  });

  it("shows Training / Learning as the canonical child-derived 5/6 (module + Skill Cards)", () => {
    renderDashboard();
    expect(within(screen.getByTestId("module-training")).getByText("5/6")).toBeInTheDocument();
    expect(within(screen.getByTestId("learning-skill_cards")).getByText("5/6")).toBeInTheDocument();
    // Hidden/unselected learning items never render as 0/0 rows.
    expect(screen.queryByTestId("learning-quizzes")).not.toBeInTheDocument();
  });

  it("uses the same module counts, KPIs, utilisation and checkpoints as Sponsor Leader Detail for the same enrollment", () => {
    const learner = renderDashboard();
    const learnerKpis = screen.getByTestId("programme-kpis").textContent;
    const learnerModules = moduleRatios(learner.container);
    const learnerUtilisation = screen.getByTestId("coaching-utilisation").textContent;
    const learnerCheckpoints = checkpoints(learner.container);
    cleanup();

    const sponsor = renderSponsor();
    expect(screen.getByTestId("programme-kpis").textContent).toBe(learnerKpis);
    expect(moduleRatios(sponsor.container)).toEqual(learnerModules);
    expect(moduleRatios(sponsor.container)).toEqual(["coaching 4/4", "training 5/6", "peer 2/2", "mentoring 2/2", "triads 1/2"]);
    expect(screen.getByTestId("coaching-utilisation").textContent).toBe(learnerUtilisation);

    // The Dashboard's summary journey is an unaltered window of the sponsor's full journey.
    const sponsorCheckpoints = checkpoints(sponsor.container);
    expect(sponsorCheckpoints).toHaveLength(6);
    expect(learnerCheckpoints).toHaveLength(4);
    expect(sponsorCheckpoints.slice(2, 6)).toEqual(learnerCheckpoints);
  });

  it("renders the shared Programme Journey with canonical statuses and cumulative units", () => {
    renderDashboard();
    const journey = screen.getByTestId("programme-journey");
    expect(journey).toHaveAttribute("data-viewer", "learner");
    expect(journey).toHaveAttribute("data-variant", "summary");
    const states = screen.getAllByTestId("journey-checkpoint").map((el) => el.getAttribute("data-state"));
    expect(states).toEqual(["completed", "completed", "current", "upcoming"]);
    expect(screen.getByText("3 / 3")).toBeInTheDocument();
    expect(screen.getByText("Showing checkpoints 3–6 of 6")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /View full journey/ })).toHaveAttribute("href", "/coachee/journey#programme-journey");
  });

  it("gives the learner expanded goal & action detail from their own records", () => {
    renderDashboard();
    const goals = screen.getByTestId("learner-goal-list");
    expect(within(goals).getByText(PRIVATE_GOAL)).toBeInTheDocument();
    expect(within(goals).getByText(/Every report leaves with one agreed next step/)).toBeInTheDocument();
    expect(within(goals).getByText(PRIVATE_MILESTONE)).toBeInTheDocument();
    expect(within(goals).getByText(PRIVATE_ACTION)).toBeInTheDocument();
    expect(within(goals).getByText(`“${PRIVATE_CHECKIN_NOTE}”`)).toBeInTheDocument();
    expect(within(goals).getByText("Last check-in Mar 1, 2026 · 35 → 50")).toBeInTheDocument();
    expect(within(goals).getByText("50% towards target")).toBeInTheDocument();
    expect(within(goals).getByText("Milestones 1/2")).toBeInTheDocument();
    // Summary row is the canonical engagement row (same as sponsor), not a client recount.
    expect(within(screen.getByTestId("goal-summary")).getByText("1 / 3")).toBeInTheDocument();
    // Overdue action is repositioned into "Needs your attention" with a working link.
    const attention = screen.getByTestId("learner-attention");
    expect(within(attention).getByRole("link", { name: new RegExp(PRIVATE_ACTION) })).toHaveAttribute("href", "/coachee/journey#goals");
  });

  it("shows learner-visible feedback and the learner's own reflections", () => {
    renderDashboard();
    const summary = screen.getByTestId("feedback-summary");
    expect(summary).toHaveTextContent("1Feedback received1ReflectionsMar 4, 2026Latest activity");
    const recent = screen.getByTestId("feedback-recent");
    expect(within(recent).getByText(`“${MENTOR_FEEDBACK}”`)).toBeInTheDocument();
    expect(within(recent).getByText(`“${PRIVATE_REFLECTION}”`)).toBeInTheDocument();
    expect(within(screen.getByTestId("development-activity")).getByText("Coaching session completed")).toBeInTheDocument();
  });

  it("renders per-goal progress from canonical_goal_progress, never recomputed from the raw ratings", () => {
    // Raw ratings for goal-1 are 20 → 50 → 80 (a client formula would say 50%);
    // the canonical value wins and is only rounded for display.
    state.goalProgress = { progressByGoal: { "goal-1": 47.6, "goal-2": null }, loading: false, error: null };
    renderDashboard();
    const goals = screen.getByTestId("learner-goal-list");
    expect(within(goals).getByText("48% towards target")).toBeInTheDocument();
    expect(within(goals).queryByText("50% towards target")).not.toBeInTheDocument();
    expect(within(goals).getByText("Not rated yet")).toBeInTheDocument();
  });

  it("shows an error instead of goal detail when canonical per-goal progress fails", () => {
    state.goalProgress = { progressByGoal: {}, loading: false, error: "function not found" };
    renderDashboard();
    expect(screen.getByText("Your goals and actions could not be loaded.")).toBeInTheDocument();
    expect(screen.queryByTestId("learner-goal-list")).not.toBeInTheDocument();
  });

  it("shows — rather than 0% when there is no configured requirement", () => {
    state.canonical = { ...state.canonical, progress: { ...canonicalProgress, full_completion_pct: null } };
    renderDashboard();
    expect(within(screen.getByTestId("programme-kpis")).queryByText("0%")).not.toBeInTheDocument();
  });

  it("takes reflections from the canonical reflection feed for the selected enrollment", () => {
    renderDashboard();
    expect(state.reflectionFeedCalls).toContain(ENROLLMENT_ID);
    const recent = screen.getByTestId("feedback-recent");
    expect(within(recent).getByText("Journey · Personal reflection")).toBeInTheDocument();
  });

  it("separates a feedback fetch failure from a genuine empty state", () => {
    state.feedback = { feedback: [], loading: false, error: "PGRST200" };
    state.development = { events: [], loading: false, error: null, partialFailure: false };
    state.reflections = { reflections: [], loading: false, error: null };
    const { unmount } = renderDashboard();
    expect(screen.getByText(/Feedback could not be loaded because of a connection or server error/)).toBeInTheDocument();
    expect(screen.queryByText("No feedback available yet, and no reflections submitted yet.")).not.toBeInTheDocument();
    unmount();

    state.feedback = { feedback: [], loading: false, error: null };
    state.reflections = { reflections: [], loading: false, error: null };
    renderDashboard();
    expect(screen.getByText("No feedback available yet, and no reflections submitted yet.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a retryable error — not the no-enrollment message — when canonical progress fails", () => {
    const retry = vi.fn();
    state.canonical = { progress: null, modules: [], journey: [], experience: canonicalExperience, loading: false, error: "timeout", retry };
    renderDashboard();
    expect(screen.getByRole("alert")).toHaveTextContent("Your programme progress could not be loaded");
    expect(screen.queryByText("Your programme details will appear here once you have an active enrollment.")).not.toBeInTheDocument();
    screen.getByRole("button", { name: "Try again" }).click();
    expect(retry).toHaveBeenCalled();
  });

  it("renders an honest no-enrollment state with no sample data", () => {
    state.canonical = { progress: null, modules: [], journey: [], experience: canonicalExperience, loading: false, error: null, retry: vi.fn() };
    renderDashboard();
    expect(screen.getByText("Your programme details will appear here once you have an active enrollment.")).toBeInTheDocument();
    expect(screen.queryByTestId("programme-kpis")).not.toBeInTheDocument();
  });

  it("shows an explicit error on the goal summary when the engagement RPC fails, never zeros", () => {
    state.engagement = { engagement: { goal_count: null, goal_progress_pct: null, open_action_count: null, completed_action_count: null, total_action_count: null, satisfaction_avg: null, satisfaction_rated_count: null }, loading: false, error: "function not found" };
    renderDashboard();
    expect(screen.getByText("Goal and action totals could not be loaded.")).toBeInTheDocument();
    expect(within(screen.getByTestId("programme-kpis")).queryByText("0%")).not.toBeInTheDocument();
  });
});

describe("Sponsor Leader Detail — privacy boundary on the shared profile", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    state.learnerHookCalls = [];
    seedPopulated();
  });

  it("never loads or renders learner-private goal, action, reflection or feedback detail", () => {
    // (includes the canonical reflection feed: the sponsor surface never calls it)
    renderSponsor();
    expect(state.learnerHookCalls).toEqual([]);
    for (const privateText of [PRIVATE_GOAL, PRIVATE_MILESTONE, PRIVATE_ACTION, PRIVATE_CHECKIN_NOTE, MENTOR_FEEDBACK, PRIVATE_REFLECTION]) {
      expect(screen.queryByText(new RegExp(privateText.slice(0, 20)))).not.toBeInTheDocument();
    }
    expect(screen.queryByTestId("learner-goal-list")).not.toBeInTheDocument();
    expect(screen.queryByTestId("feedback-summary")).not.toBeInTheDocument();
    expect(screen.getByTestId("programme-journey")).toHaveAttribute("data-viewer", "sponsor");
    // Sponsor keeps its sponsor-safe summary.
    expect(within(screen.getByTestId("goal-summary")).getByText("1 / 3")).toBeInTheDocument();
    expect(screen.getByText("Goal wording, action detail and private notes stay between the leader and their coach.")).toBeInTheDocument();
  });
});

describe("My Journey — shared Programme Journey (full variant)", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    seedPopulated();
  });

  it("renders every checkpoint identically to Sponsor Leader Detail, plus learner detail", () => {
    const sponsor = renderSponsor();
    const sponsorCheckpoints = checkpoints(sponsor.container);
    cleanup();

    const mine = render(
      <MemoryRouter>
        <LearnerProgrammeJourney enrollmentId={ENROLLMENT_ID} variant="full" />
      </MemoryRouter>
    );
    expect(screen.getByTestId("programme-journey")).toHaveAttribute("data-variant", "full");
    expect(checkpoints(mine.container)).toEqual(sponsorCheckpoints);
    const detail = screen.getByTestId("checkpoint-detail");
    // Training week title is source content, shown with the Training item — not as the checkpoint title.
    expect(within(detail).getByTestId("checkpoint-training-weeks")).toHaveTextContent("Training / Learning · Week 9");
    expect(within(detail).getByText("This checkpoint is due today.")).toBeInTheDocument();
    expect(within(detail).getByRole("link", { name: /Training \/ Learning/ })).toHaveAttribute("href", "/training");
  });
});
