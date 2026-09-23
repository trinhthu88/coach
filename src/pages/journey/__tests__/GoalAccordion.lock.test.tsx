import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import "@/i18n/config";
import { GoalAccordion } from "../GoalAccordion";
import { ACCENTS } from "../journeyDisplay";

const goal = {
  id: "g1", title: "Hold my first round of one-to-ones", description: null, status: "active",
  target_date: null, created_at: "2026-09-17T12:00:00Z", sort_order: 0,
} as never;

describe("GoalAccordion — Start and Target are the learner's; only Current is captured after sessions", () => {
  it("keeps Start and Target editable, without a Locked badge, and marks Current as captured after each session", () => {
    render(
      <MemoryRouter>
        <GoalAccordion
          goal={goal} milestones={[]} actions={[]} accent={ACCENTS[0]}
          onToggle={vi.fn()} onToggleAction={vi.fn()} onAddMilestone={vi.fn()} onDeleteGoal={vi.fn()} onDeleteMilestone={vi.fn()}
          defaultOpen
          rating={{ goalId: "g1", title: "Hold my first round of one-to-ones", start: 20, current: null, target: 70, progress: null }}
          onRatingChange={vi.fn()}
        />
      </MemoryRouter>
    );
    expect(screen.queryByText("Locked")).toBeNull();
    expect(screen.queryByText("Locked after your next completed session")).toBeNull();
    const inputs = screen.getAllByRole("spinbutton");
    expect(inputs.map((i) => (i as HTMLInputElement).value)).toEqual(["20", "70"]);
    for (const input of inputs) expect(input).toBeEnabled();
    const current = screen.getByTestId("goal-current-locked");
    expect(current).toHaveTextContent("current rating is captured after each session");
    expect(current.querySelector("svg")).not.toBeNull();
  });
});
