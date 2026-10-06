import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { format } from "date-fns";
import { canonicalProgress } from "@/test/fixtures/canonicalEnrollment";

/**
 * "Sessions received" on the Coach's own learner journey is the canonical
 * Coaching row (learner_canonical_progress), never session rows counted in
 * React over a configured receive_limit (20261006110000).
 */
// Assessment feedback has its own tests (AssessmentFeedbackSection.test.tsx).
// The Final Assessment card has its own tests (FinalAssessmentResults.test.tsx).
vi.mock("@/components/assessments/FinalAssessmentResults", () => ({
  LearnerFinalAssessmentSection: () => null,
  SponsorFinalAssessmentSection: () => null,
  AdminFinalAssessmentDetail: () => null,
}));
vi.mock("@/components/assessments/AssessmentFeedbackSection", () => ({ AssessmentFeedbackSection: () => null }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => (opts?.count !== undefined ? `${key}:${opts.count}` : key),
  }),
}));
vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "coach-1" }, profile: { full_name: "Kim Coach" }, role: "coach" }),
}));
vi.mock("@/hooks/journey/useJourneyProgramme", () => ({
  useJourneyProgramme: () => ({
    programme: { enrollmentId: "enrollment-1", programmeName: "P", cohortName: null, startDate: null, endDate: null, durationMonths: 3 },
    coaching: { requiredUnits: 3, completedUnits: 1, bookedUnits: 2, dueUnits: 1, overdueUnits: 0, postSessionPending: 0 },
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));
const NEXT_AT = "2026-11-03T02:30:00Z";
vi.mock("@/hooks/useLearnerCanonicalProgress", () => ({
  useLearnerCanonicalProgress: () => ({
    progress: { ...canonicalProgress, coaching_required_units: 3, coaching_completed_units: 1 },
    modules: [{ module: "coaching", full_completion_pct: 33.3 }],
    journey: [],
    experience: {
      weeklyParticipation: [], learningBreakdown: [],
      coachingUtilisation: { required_units: 3, completed_units: 1, due_units: 1, booked_units: 2, utilisation_pct: 100, next_session_at: NEXT_AT },
    },
    loading: false, error: null, retry: vi.fn(),
  }),
  useLearnerCanonicalGoalProgress: () => ({ progressByGoal: {}, loading: false, error: null }),
  useLearnerCanonicalEngagement: () => ({ engagement: { goal_progress_pct: 40 }, loading: false, error: null }),
}));
// Five completed Coaching rows: a React count would say 5.
const completed = Array.from({ length: 5 }, (_, i) => ({
  id: `s${i}`, status: "completed", start_time: "2026-01-0" + (i + 1) + "T09:00:00Z", coach_id: "c", topic: "T", enrollment_actions: [],
}));
vi.mock("@/hooks/journey/useJourneySessions", () => ({
  useJourneySessions: () => ({ coachingSessions: completed, peerSessions: [], coachNames: {}, loading: false, toggleAction: vi.fn() }),
}));
vi.mock("@/hooks/journey/useJourneyGoals", () => ({
  useJourneyGoals: () => ({ goals: [], milestones: [], loading: false, toggleMilestone: vi.fn() }),
}));
vi.mock("@/hooks/journey/useJourneyRatings", () => ({
  useJourneyRatings: () => ({ ratings: {}, sessionRatings: [], loading: false, saveRating: vi.fn() }),
}));
vi.mock("@/hooks/journey/useJourneyReflections", () => ({
  useJourneyReflections: () => ({ reflections: [], loading: false, deleteReflection: vi.fn() }),
}));
vi.mock("@/hooks/journey/useEnrollmentDevelopmentJourney", () => ({
  useEnrollmentDevelopmentJourney: () => ({ events: [], loading: false, error: null, partialFailure: false }),
}));
vi.mock("@/hooks/dashboard/useLearnerFeedback", () => ({
  useLearnerFeedback: () => ({ feedback: [], loading: false, error: null }),
}));
vi.mock("@/hooks/journey/useEnrollmentSessions", () => ({
  useEnrollmentSessions: () => ({ sessions: [], loading: false, error: null }),
}));
vi.mock("@/hooks/journey/useJourneyDerived", () => ({
  useProgrammeWeeks: () => [],
  useSessionRatingSeries: () => [],
  usePendingReflection: () => ({ pendingReflectionSession: null, needsRatingUpdate: false }),
}));
vi.mock("@/hooks/journey/useCoachSummaries", () => ({ useCoachSummaries: () => [] }));
// Child sections have their own tests; this page test is about the metric row.
vi.mock("../journey/ProgrammeTimeline", () => ({ ProgrammeTimeline: () => null }));
vi.mock("../journey/CoachProgrammeCard", () => ({
  CoachProgrammeCard: (props: { coaching: unknown; avgGoalProgress: unknown }) => (
    <pre data-testid="programme-card">{JSON.stringify({ coaching: props.coaching, avgGoalProgress: props.avgGoalProgress })}</pre>
  ),
}));
vi.mock("../journey/DevelopmentJourneyTimeline", () => ({ DevelopmentJourneyTimeline: () => null }));
vi.mock("../journey/DevelopmentSessionsList", () => ({ DevelopmentSessionsList: () => null }));
vi.mock("../journey/SessionsBlock", () => ({ SessionsBlock: () => null }));
vi.mock("../journey/ActionGroups", () => ({ ActionGroups: () => null }));
vi.mock("../journey/GoalWheel", () => ({ GoalWheel: () => null, GoalScoreCards: () => null }));
vi.mock("@/components/programme/LearnerProgrammeJourney", () => ({ LearnerProgrammeJourney: () => null }));

import CoachMyJourney from "../CoachMyJourney";

describe("CoachMyJourney sessions received", () => {
  it("shows canonical Coaching units, not a count of session rows", () => {
    render(<MemoryRouter><CoachMyJourney /></MemoryRouter>);
    const label = screen.getByText("coachMyJourney.metrics.sessionsReceived");
    const metric = label.parentElement as HTMLElement;
    expect(metric).toHaveTextContent("1 / 3");
    expect(metric).not.toHaveTextContent("5");
    expect(metric).not.toHaveTextContent("null");
  });

  it("next session, upcoming count, Coaching bar and goal average are the canonical rows' (Prompt 9a)", () => {
    render(<MemoryRouter><CoachMyJourney /></MemoryRouter>);
    // "N upcoming" is the canonical booked Coaching units, not a count of rows.
    expect(screen.getByText("coachMyJourney.metrics.sessionsReceivedSub:2")).toBeInTheDocument();
    // Next session is coaching_utilisation.next_session_at.
    const next = screen.getByText("coachMyJourney.metrics.nextSession").parentElement as HTMLElement;
    expect(next).toHaveTextContent(format(new Date(NEXT_AT), "MMM d"));
    const card = JSON.parse(screen.getByTestId("programme-card").textContent ?? "{}");
    expect(card.coaching.completionPct).toBe(33.3);
    expect(card.avgGoalProgress).toBe(40);
  });
});
