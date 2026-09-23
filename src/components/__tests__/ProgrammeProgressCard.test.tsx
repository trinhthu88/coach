import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const learnerCanonicalProgress = vi.fn();
const moduleAccess = vi.fn();
const programmeProgress = vi.fn();

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "learner-1" }, role: "coachee" }),
}));
vi.mock("@/hooks/useProgrammeModules", () => ({
  useProgrammeModules: () => moduleAccess(),
}));
vi.mock("@/hooks/useLearnerCanonicalProgress", () => ({
  useLearnerCanonicalProgress: (...args: unknown[]) => learnerCanonicalProgress(...args),
}));
vi.mock("@/hooks/dashboard/useProgrammeProgress", () => ({
  useProgrammeProgress: () => programmeProgress(),
  }));
/* default hook data is reset per test so the blocked state is explicit. */
const defaultProgrammeProgress = () => ({
    enrollmentId: "enrollment-1",
    summary: {
      weeksTotal: 0,
      quizScores: [],
      quizAvg: null,
      reflectionStreak: 0,
      weeks: [],
      currentWeek: null,
      currentQuizAssignmentId: null,
      quizAssignmentIdByWeek: {},
    },
    loading: false,
  });
vi.mock("@/hooks/journey/useJourneyGoals", () => ({
  useJourneyGoals: () => ({ goals: [], loading: false }),
}));
vi.mock("@/components/training/DailyPromptCard", () => ({ DailyPromptCard: () => null }));

import "@/i18n/config";
import { ProgrammeProgressCard } from "../ProgrammeProgressCard";

const coaching = {
  module: "coaching",
  full_completion_pct: 25,
  due_adherence_pct: 50,
  pace_status: "behind",
  completed_units: 1,
  due_units: 2,
  required_units: 4,
  booked_units: 1,
};

const emptyExperience = { weeklyParticipation: [], learningBreakdown: [], coachingUtilisation: null };

const fourLearningItems = [
  { key: "skill_cards", label: "Skill Cards", required_units: 8, due_units: 5, completed_units: 5, overdue_units: 0, progress_available: true, status: "current" as const },
  { key: "quizzes", label: "Quizzes", required_units: 8, due_units: 5, completed_units: 4, overdue_units: 1, progress_available: true, status: "overdue" as const },
  { key: "reflections", label: "Reflections", required_units: 8, due_units: 5, completed_units: 5, overdue_units: 0, progress_available: true, status: "current" as const },
  { key: "daily_prompts", label: "Daily Prompts", required_units: 5, due_units: 5, completed_units: 3, overdue_units: 2, progress_available: true, status: "overdue" as const },
];

const defaultCanonicalProgress = () => ({
  progress: {
    programme_label: "Leadership Programme",
    programme_end_date: "2026-12-01",
    required_units: 4,
    completed_units: 1,
    full_completion_pct: 25,
  },
  modules: [coaching],
  journey: [],
  experience: emptyExperience,
  loading: false,
  error: null,
});

describe("ProgrammeProgressCard", () => {
  beforeEach(() => {
    programmeProgress.mockReturnValue(defaultProgrammeProgress());
    moduleAccess.mockReturnValue({
      hasModule: () => false,
      hasDirection: () => false,
      loading: false,
    });
    learnerCanonicalProgress.mockReturnValue(defaultCanonicalProgress());
  });

  it("renders an explicit blocked state without an enrollment", () => {
    programmeProgress.mockReturnValue({ ...defaultProgrammeProgress(), enrollmentId: null });
    render(<MemoryRouter><ProgrammeProgressCard /></MemoryRouter>);
    expect(screen.getByText("Programme progress is unavailable until an enrollment is selected.")).toBeInTheDocument();
  });

  it("renders authoritative module progress for a coaching-only enrollment", () => {
    render(<MemoryRouter><ProgrammeProgressCard /></MemoryRouter>);

    expect(screen.getByText("Coaching")).toBeInTheDocument();
    expect(screen.getByText("25%")).toBeInTheDocument();
    expect(screen.getByText("1 of 4 completed")).toBeInTheDocument();
    expect(screen.queryByText("Skills completed")).not.toBeInTheDocument();
  });

  it("renders the canonical overall progress figure, not a client-computed one", () => {
    render(<MemoryRouter><ProgrammeProgressCard /></MemoryRouter>);

    expect(screen.getByText("1 of 4 activities complete (25%)")).toBeInTheDocument();
  });

  it("renders every enabled RPC module in a blended programme without training", () => {
    learnerCanonicalProgress.mockReturnValue({
      ...defaultCanonicalProgress(),
      modules: [
        coaching,
        { ...coaching, module: "mentoring", full_completion_pct: 75, completed_units: 3 },
      ],
    });

    render(<MemoryRouter><ProgrammeProgressCard /></MemoryRouter>);

    expect(screen.getByText("Coaching")).toBeInTheDocument();
    expect(screen.getByText("Mentoring")).toBeInTheDocument();
    expect(screen.getByText("75%")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View content" })).not.toBeInTheDocument();
  });

  it("renders all four configured learning categories from the canonical breakdown", () => {
    moduleAccess.mockReturnValue({
      hasModule: (module: string) => module === "training",
      hasDirection: () => false,
      loading: false,
    });
    programmeProgress.mockReturnValue({
      ...defaultProgrammeProgress(),
      summary: { ...defaultProgrammeProgress().summary, weeksTotal: 4 },
    });
    learnerCanonicalProgress.mockReturnValue({
      ...defaultCanonicalProgress(),
      modules: [{ ...coaching, module: "training", required_units: 4, completed_units: 3 }],
      experience: { ...emptyExperience, learningBreakdown: fourLearningItems },
    });

    render(<MemoryRouter><ProgrammeProgressCard /></MemoryRouter>);

    for (const item of fourLearningItems) {
      const card = screen.getByText(item.label).parentElement;
      expect(card).not.toBeNull();
      expect(within(card!).getByText(new RegExp(`${item.completed_units}\\s*/\\s*${item.required_units}`))).toBeInTheDocument();
    }
  });
});
