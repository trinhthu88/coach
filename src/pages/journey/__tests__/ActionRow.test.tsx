import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { addDays, format } from "date-fns";

vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ role: "coachee" }) }));

import "@/i18n/config";
import { ActionRow } from "../ActionRow";
import type { FlatAction } from "@/hooks/journey/useFlatActionItems";

const day = (n: number) => format(addDays(new Date(), n), "yyyy-MM-dd");
const action = (patch: Partial<FlatAction>): FlatAction => ({
  text: "Practise silence",
  done: false,
  due_date: day(10),
  goal_id: "g1",
  sessionId: "s1",
  sessionTopic: "Session 1",
  sessionDate: "2026-09-01T09:00:00Z",
  idx: 0,
  source: "coaching",
  ...patch,
});

function renderRow(a: FlatAction, goalTitle?: string) {
  return render(
    <MemoryRouter>
      <ActionRow a={a} goalTitle={goalTitle} />
    </MemoryRouter>,
  );
}

describe("ActionRow — due date status and goal link", () => {
  it.each([
    [-1, "overdue", "text-destructive"],
    [0, "dueSoon", "text-warning"],
    [7, "dueSoon", "text-warning"],
    [8, "onTrack", "text-success"],
  ])("an open action due in %i days reads %s", (offset, status, colour) => {
    renderRow(action({ due_date: day(offset) }));
    const due = screen.getByTestId("action-due");
    expect(due).toHaveAttribute("data-status", status);
    expect(due).toHaveClass(colour);
  });

  it("a done action is never overdue", () => {
    renderRow(action({ done: true, due_date: day(-5) }));
    expect(screen.getByTestId("action-due")).toHaveAttribute("data-status", "done");
  });

  it("links the action to its goal", () => {
    renderRow(action({}), "Lead with questions");
    const goal = screen.getByTestId("action-goal");
    expect(goal).toHaveTextContent("Goal: Lead with questions");
    expect(goal).toHaveAttribute("href", "/coachee/journey#goal-g1");
  });

  it("shows no goal tag inside the goal itself (no title passed)", () => {
    renderRow(action({}));
    expect(screen.queryByTestId("action-goal")).toBeNull();
  });
});
