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
  week(1, { completed_at: "2026-01-08T00:00:00Z", requirement_due_on: "2026-01-08", requirement_state: "completed" }),
  week(2, { viewed_at: "2026-02-02T00:00:00Z" }),
  week(3, { requirement_due_on: "2026-03-01", requirement_state: "overdue" }),
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
      // learner_training_week_items: child evidence per week (counts only).
      itemsByWeek: {
        w3: [
          { item_type: "skill_cards", required_units: 1, completed_units: 0, due_units: 1, overdue_units: 1 },
          { item_type: "quizzes", required_units: 1, completed_units: 1, due_units: 1, overdue_units: 0 },
          { item_type: "reflections", required_units: 1, completed_units: 0, due_units: 0, overdue_units: 0 },
          { item_type: "daily_prompts", required_units: 2, completed_units: 1, due_units: 2, overdue_units: 1 },
        ],
      },
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

describe("Training & Learning — each week shows its programme requirement and child evidence", () => {
  it("shows the canonical requirement date and state, and every configured child type with its own count", () => {
    render(
      <MemoryRouter>
        <TrainingWeeks />
      </MemoryRouter>
    );
    const week3 = cardFor("Week 3 title");
    expect(within(week3).getByTestId("week-requirement")).toHaveTextContent(/Mar 1, 2026.*Overdue/);
    expect(within(week3).getByTestId("week-item-skill_cards")).toHaveTextContent("0/1");
    expect(within(week3).getByTestId("week-item-quizzes")).toHaveTextContent("1/1");
    expect(within(week3).getByTestId("week-item-reflections")).toHaveTextContent("0/1");
    // Two prompts exist in this week, so the denominator is two.
    expect(within(week3).getByTestId("week-item-daily_prompts")).toHaveTextContent("1/2");
    expect(within(cardFor("Week 1 title")).getByTestId("week-requirement")).toHaveTextContent(/Completed/);
    // A week that is not a requirement carries no requirement line.
    expect(within(cardFor("Week 2 title")).queryByTestId("week-requirement")).toBeNull();
  });
});
