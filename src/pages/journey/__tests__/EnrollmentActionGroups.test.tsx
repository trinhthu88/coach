import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import "@/i18n/config";
import { EnrollmentActionGroups } from "../EnrollmentActionGroups";
import type { EnrollmentActionRow, EnrollmentActionsSummary } from "@/hooks/dashboard/useEnrollmentActionsSummary";
import type { FlatAction } from "@/hooks/journey/useFlatActionItems";

const action = (overrides: Partial<EnrollmentActionRow>): EnrollmentActionRow => ({
  id: "a1",
  title: "Send preparation note",
  description: null,
  status: "open",
  due_date: null,
  goal_id: null,
  milestone_id: null,
  completed_at: null,
  ...overrides,
});

const summary = (overrides: Partial<EnrollmentActionsSummary>): EnrollmentActionsSummary => ({
  actions: [],
  overdue: [],
  dueThisWeek: [],
  upcoming: [],
  completed: [],
  total: 0,
  openCount: 0,
  completedCount: 0,
  completionPct: null,
  ...overrides,
});

describe("EnrollmentActionGroups", () => {
  it("shows an explicit empty state when there are no actions at all", () => {
    render(
      <EnrollmentActionGroups
        summary={summary({})}
        goals={[]}
        toggleableById={new Map()}
        onToggleAction={vi.fn()}
        emptyMessage="No action items yet."
      />
    );
    expect(screen.getByText("No action items yet.")).toBeInTheDocument();
  });

  // Regression: the coaching-session-derived action list only ever saw
  // actions whose source_activity_type was "coaching", silently dropping
  // any action created from a mentoring or peer-coaching session. This
  // component reads every enrollment_actions row regardless of source, so a
  // mentoring-sourced action (one that would never appear in a
  // coaching-session-only projection) must still render here.
  it("shows actions regardless of their originating module, not just coaching-sourced ones", () => {
    const mentoringSourcedAction = action({ id: "mentoring-a1", title: "Bring one coaching practice question" });
    render(
      <EnrollmentActionGroups
        summary={summary({ upcoming: [mentoringSourcedAction], total: 1, openCount: 1 })}
        goals={[]}
        toggleableById={new Map()} // empty — this action has no coaching-session toggle path
        onToggleAction={vi.fn()}
        emptyMessage="No action items yet."
      />
    );
    expect(screen.getByText("Bring one coaching practice question")).toBeInTheDocument();
  });

  it("groups actions into Overdue / Due this week / Upcoming / Completed and resolves the linked goal title", () => {
    render(
      <EnrollmentActionGroups
        summary={summary({
          overdue: [action({ id: "a1", title: "Overdue task", goal_id: "g1" })],
          upcoming: [action({ id: "a2", title: "Upcoming task" })],
          completed: [action({ id: "a3", title: "Done task", status: "completed" })],
          total: 3,
          openCount: 2,
          completedCount: 1,
        })}
        goals={[{ id: "g1", title: "Build confidence", description: null, target_date: null, status: "active", created_at: "2026-01-01" }]}
        toggleableById={new Map()}
        onToggleAction={vi.fn()}
        emptyMessage="No action items yet."
      />
    );
    expect(screen.getByText("Overdue · 1")).toBeInTheDocument();
    expect(screen.getByText("Upcoming · 1")).toBeInTheDocument();
    expect(screen.getByText("Completed · 1")).toBeInTheDocument();
    expect(screen.getByText(/Build confidence/)).toBeInTheDocument();
  });

  it("only calls onToggleAction for a row that has a matching toggleable FlatAction", () => {
    const onToggle = vi.fn();
    const toggleable: FlatAction = {
      id: "a1",
      text: "Send preparation note",
      done: false,
      goal_id: null,
      milestone_id: null,
      due_date: null,
      sessionId: "s1",
      sessionTopic: "Session 1",
      sessionDate: "2026-01-01",
      idx: 0,
      source: "coaching",
    };
    render(
      <EnrollmentActionGroups
        summary={summary({ upcoming: [action({ id: "a1" }), action({ id: "a2", title: "Not toggleable here" })], total: 2, openCount: 2 })}
        goals={[]}
        toggleableById={new Map([["a1", toggleable]])}
        onToggleAction={onToggle}
        emptyMessage="No action items yet."
      />
    );
    // Row order follows summary.upcoming: a1 (toggleable) then a2 (not).
    const buttons = screen.getAllByLabelText("Toggle action");
    expect(buttons).toHaveLength(2);

    fireEvent.click(buttons[0]);
    expect(onToggle).toHaveBeenCalledWith(toggleable);

    onToggle.mockClear();
    fireEvent.click(buttons[1]); // action a2, not toggleable — disabled, no-op
    expect(onToggle).not.toHaveBeenCalled();
  });
});
