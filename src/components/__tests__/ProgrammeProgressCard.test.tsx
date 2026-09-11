import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const enrollmentProgress = vi.fn();
const moduleAccess = vi.fn();
const programmeProgress = vi.fn();

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "learner-1" }, role: "coachee" }),
}));
vi.mock("@/hooks/useProgrammeModules", () => ({
  useProgrammeModules: () => moduleAccess(),
}));
vi.mock("@/hooks/useEnrollmentProgress", () => ({
  useEnrollmentProgress: (...args: unknown[]) => enrollmentProgress(...args),
}));
vi.mock("@/hooks/dashboard/useProgrammeProgress", () => ({
  useProgrammeProgress: () => programmeProgress(),
  }));
/* default hook data is reset per test so the blocked state is explicit. */
const defaultProgrammeProgress = () => ({
    enrollmentId: "enrollment-1",
    summary: {
      weeksCompleted: 0,
      weeksTotal: 0,
      quizScores: [],
      quizAvg: null,
      reflectionStreak: 0,
      triadCompletedCount: 0,
      nextTriadDate: null,
      weeks: [],
      currentWeek: null,
      currentQuizAssignmentId: null,
    },
    loading: false,
  });
vi.mock("@/hooks/journey/useJourneyProgramme", () => ({
  useJourneyProgramme: () => ({
    programme: { programmeName: "Leadership Programme", endDate: "2026-12-01" },
    loading: false,
  }),
}));
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

describe("ProgrammeProgressCard", () => {
  beforeEach(() => {
    programmeProgress.mockReturnValue(defaultProgrammeProgress());
    moduleAccess.mockReturnValue({
      hasModule: () => false,
      hasDirection: () => false,
      loading: false,
    });
    enrollmentProgress.mockReturnValue({ modules: [coaching], loading: false, error: null });
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

  it("renders every enabled RPC module in a blended programme without training", () => {
    enrollmentProgress.mockReturnValue({
      modules: [
        coaching,
        { ...coaching, module: "mentoring", full_completion_pct: 75, completed_units: 3 },
      ],
      loading: false,
      error: null,
    });

    render(<MemoryRouter><ProgrammeProgressCard /></MemoryRouter>);

    expect(screen.getByText("Coaching")).toBeInTheDocument();
    expect(screen.getByText("Mentoring")).toBeInTheDocument();
    expect(screen.getByText("75%")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View skill card" })).not.toBeInTheDocument();
  });
});
