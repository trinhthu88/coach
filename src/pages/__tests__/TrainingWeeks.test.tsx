import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

const week = (n: number, patch: Record<string, unknown>) => ({
  id: `w${n}`,
  week_number: n,
  title: `Week ${n} title`,
  title_vi: null,
  subtitle: null,
  subtitle_vi: null,
  unlock_date: null,
  effective_unlock_date: `2026-0${n}-01`,
  locked: false,
  viewed_at: null,
  completed_at: null,
  ...patch,
});

const weeks = [
  week(1, { completed_at: "2026-01-08T00:00:00Z" }),
  week(2, { viewed_at: "2026-02-02T00:00:00Z" }),
  week(3, {}),
  week(4, { locked: true }),
];

vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "learner-1" } }) }));
vi.mock("@/hooks/useProgrammeModules", () => ({ useProgrammeModules: () => ({ hasModule: () => true }) }));
vi.mock("@/hooks/dashboard/useProgrammeProgress", () => ({
  useProgrammeProgress: () => ({
    loading: false,
    summary: {
      weeksTotal: 4,
      quizScores: [{ weekNumber: 1, scorePct: 80 }],
      quizAvg: 80,
      reflectionStreak: 0,
      weeks,
      currentWeek: weeks[1],
      currentQuizAssignmentId: "q2",
      quizAssignmentIdByWeek: { w1: "q1", w2: "q2", w3: "q3", w4: "q4" },
    },
  }),
}));

import "@/i18n/config";
import TrainingWeeks from "../TrainingWeeks";

function cardFor(title: string) {
  return screen.getByText(title).closest("div.relative") as HTMLElement;
}

describe("Training & Learning — previous weeks stay open", () => {
  it("every unlocked week (completed, viewed, current, not started) links to its skill card and quiz", () => {
    render(
      <MemoryRouter>
        <TrainingWeeks />
      </MemoryRouter>
    );
    for (const n of [1, 2, 3]) {
      const card = cardFor(`Week ${n} title`);
      expect(within(card).getByTestId("week-skill-card-link")).toHaveAttribute("href", `/training/w${n}`);
      const quiz = within(card).getAllByRole("link").find((l) => l.getAttribute("href")?.includes("/quiz/"));
      expect(quiz).toHaveAttribute("href", `/training/w${n}/quiz/q${n}`);
    }
  });

  it("a locked (future) week has no content links", () => {
    render(
      <MemoryRouter>
        <TrainingWeeks />
      </MemoryRouter>
    );
    const locked = cardFor("Week 4 title");
    expect(within(locked).queryAllByRole("link")).toHaveLength(0);
  });
});
