import { fireEvent, render, screen, within } from "@testing-library/react";
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
        // A future week: whatever the counts say, nothing in it is completable yet.
        w4: [
          { item_type: "skill_cards", required_units: 1, completed_units: 1, due_units: 0, overdue_units: 0 },
          { item_type: "quizzes", required_units: 1, completed_units: 0, due_units: 0, overdue_units: 0 },
          { item_type: "reflections", required_units: 1, completed_units: 0, due_units: 0, overdue_units: 0 },
          { item_type: "daily_prompts", required_units: 3, completed_units: 0, due_units: 0, overdue_units: 0 },
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

function expand(card: HTMLElement) {
  const toggle = within(card).getByTestId("week-content-toggle");
  if (toggle.getAttribute("aria-expanded") !== "true") fireEvent.click(toggle);
  return within(card).getByTestId("week-content");
}

describe("Training & Learning — previous weeks stay open", () => {
  it("every unlocked week (completed, viewed, current, not started) links to its content and quiz", () => {
    render(
      <MemoryRouter>
        <TrainingWeeks />
      </MemoryRouter>
    );
    for (const n of [1, 2, 3]) {
      const content = expand(cardFor(`Week ${n} title`));
      expect(within(content).getByTestId("week-skill-card-link")).toHaveAttribute("href", `/training/w${n}`);
      const quiz = within(content).getAllByRole("link").find((l) => l.getAttribute("href")?.includes("/quiz/"));
      expect(quiz).toHaveAttribute("href", `/training/w${n}/quiz/q${n}`);
    }
  });

  it("the current week opens expanded; other weeks start collapsed behind View content", () => {
    render(
      <MemoryRouter>
        <TrainingWeeks />
      </MemoryRouter>
    );
    expect(within(cardFor("Week 2 title")).getByTestId("week-content-toggle")).toHaveAttribute("aria-expanded", "true");
    const week3 = cardFor("Week 3 title");
    expect(within(week3).getByTestId("week-content-toggle")).toHaveTextContent("View content");
    expect(within(week3).queryByTestId("week-content")).toBeNull();
  });

  it("a locked (future) week has no content links; its content reads Upcoming", () => {
    render(
      <MemoryRouter>
        <TrainingWeeks />
      </MemoryRouter>
    );
    const locked = cardFor("Week 4 title");
    const content = expand(locked);
    expect(within(locked).queryAllByRole("link")).toHaveLength(0);
    for (const type of ["skill_cards", "quizzes", "reflections", "daily_prompts"]) {
      expect(within(content).getByTestId(`week-item-${type}`)).toHaveAttribute("data-state", "upcoming");
    }
    expect(within(content).getByTestId("week-item-skill_cards")).toHaveTextContent("Upcoming");
  });
});

describe("Training & Learning — each week shows its programme requirement and all four content types", () => {
  it("shows the requirement date and state, and Skill Card, Quiz, Reflection and optional Daily Prompts with their own status", () => {
    render(
      <MemoryRouter>
        <TrainingWeeks />
      </MemoryRouter>
    );
    const week3 = cardFor("Week 3 title");
    expect(within(week3).getByTestId("week-requirement")).toHaveTextContent(/Mar 1, 2026.*Overdue/);
    const content = expand(week3);
    const rows = within(content).getAllByTestId(/^week-item-/).map((r) => r.getAttribute("data-testid"));
    expect(rows).toEqual(["week-item-skill_cards", "week-item-quizzes", "week-item-reflections", "week-item-daily_prompts"]);

    expect(within(content).getByTestId("week-item-skill_cards")).toHaveAttribute("data-state", "overdue");
    expect(within(content).getByTestId("week-item-skill_cards")).toHaveTextContent("Overdue");
    expect(within(content).getByTestId("week-item-quizzes")).toHaveAttribute("data-state", "completed");
    expect(within(content).getByTestId("week-item-reflections")).toHaveAttribute("data-state", "notStarted");
    expect(within(content).getByTestId("week-item-reflections")).toHaveTextContent("Not started");
    // Daily Prompts are optional: a count, never Overdue, even past their dates.
    const prompts = within(content).getByTestId("week-item-daily_prompts");
    expect(prompts).toHaveTextContent("Optional");
    expect(prompts).toHaveTextContent("1/2 completed");
    expect(prompts).not.toHaveAttribute("data-state", "overdue");

    expect(within(cardFor("Week 1 title")).getByTestId("week-requirement")).toHaveTextContent(/Completed/);
    // A week that is not a requirement carries no requirement line.
    expect(within(cardFor("Week 2 title")).queryByTestId("week-requirement")).toBeNull();
  });
});

describe("Training & Learning — what finishes a week is clear", () => {
  it("marks Skill Card, Quiz and Reflection Required, Daily Prompts Optional, and says so under the list", () => {
    render(
      <MemoryRouter>
        <TrainingWeeks />
      </MemoryRouter>
    );
    const content = expand(cardFor("Week 3 title"));
    for (const type of ["skill_cards", "quizzes", "reflections"]) {
      const row = within(content).getByTestId(`week-item-${type}`);
      expect(within(row).getByTestId("content-required-badge")).toHaveTextContent("Required");
      expect(row).not.toHaveTextContent("Optional");
    }
    const prompts = within(content).getByTestId("week-item-daily_prompts");
    expect(within(prompts).queryByTestId("content-required-badge")).toBeNull();
    expect(prompts).toHaveTextContent("Optional");
    expect(within(content).getByTestId("week-completion-note")).toHaveTextContent(
      "Complete Skill Card, Quiz and Reflection to finish this week. Daily Prompts are optional."
    );
  });

  it("Daily Prompts opens the week at its prompts section", () => {
    render(
      <MemoryRouter>
        <TrainingWeeks />
      </MemoryRouter>
    );
    const prompts = within(expand(cardFor("Week 3 title"))).getByTestId("week-item-daily_prompts");
    expect(within(prompts).getByRole("link", { name: "Daily Prompts" })).toHaveAttribute("href", "/training/w3#daily-prompts");
  });
});
