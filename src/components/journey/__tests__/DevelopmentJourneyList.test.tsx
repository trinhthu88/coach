import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import "@/i18n/config";
import { DevelopmentJourneyList } from "../DevelopmentJourneyList";
import type { DevelopmentJourneyEvent } from "@/hooks/journey/developmentJourneyTypes";

const event = (overrides: Partial<DevelopmentJourneyEvent>): DevelopmentJourneyEvent => ({
  id: "e1",
  enrollmentId: "enrollment-1",
  occurredAt: "2026-09-16T00:00:00Z",
  type: "reflection",
  subtype: "programme_reflection",
  title: "Learning Reflection",
  summary: null,
  sourceId: "src-1",
  sourceType: "reflection_submissions",
  ...overrides,
});

describe("DevelopmentJourneyList", () => {
  it("shows an explicit empty state when there are no events — never a fabricated history", () => {
    render(<DevelopmentJourneyList events={[]} loading={false} />);
    expect(
      screen.getByText("Nothing has happened in this programme yet — goals, sessions, and reflections will appear here as they happen.")
    ).toBeInTheDocument();
  });

  it("renders one entry per canonical event, in the order provided, without inventing extra steps", () => {
    render(
      <DevelopmentJourneyList
        events={[
          event({ id: "e1", title: "Learning Reflection", occurredAt: "2026-09-16T00:00:00Z" }),
          event({ id: "e2", title: "Mentoring session completed", occurredAt: "2026-09-14T00:00:00Z", type: "mentoring" }),
          event({ id: "e3", title: "Goal Progress", occurredAt: "2026-09-12T00:00:00Z", type: "goal" }),
        ]}
        loading={false}
      />
    );
    expect(screen.getByText("Learning Reflection")).toBeInTheDocument();
    expect(screen.getByText("Mentoring session completed")).toBeInTheDocument();
    expect(screen.getByText("Goal Progress")).toBeInTheDocument();
  });

  it("shows the event's own summary on its row — no fabricated detail", () => {
    render(
      <DevelopmentJourneyList
        events={[event({ id: "e1", title: "Triad Self-Reflection", summary: "Self-rating completed across three competencies." })]}
        loading={false}
      />
    );
    expect(screen.getByText("Triad Self-Reflection")).toBeInTheDocument();
    expect(screen.getByText("Reflection · Self-rating completed across three competencies.")).toBeInTheDocument();
  });
});

describe("DevelopmentJourneyList — design filters, months and grouping", () => {
  const events: DevelopmentJourneyEvent[] = [
    event({ id: "r1", type: "reflection", title: "Week 3 reflection", occurredAt: "2026-09-16T10:00:00Z" }),
    event({ id: "a1", type: "action", subtype: "action_completed", title: "Action A", occurredAt: "2026-09-12T10:00:00Z" }),
    event({ id: "a2", type: "action", subtype: "action_completed", title: "Action B", occurredAt: "2026-09-12T11:00:00Z" }),
    event({ id: "a3", type: "action", subtype: "action_completed", title: "Action C", occurredAt: "2026-09-12T12:00:00Z" }),
    event({ id: "m1", type: "mentoring", subtype: "session_completed", title: "Mentoring session completed", occurredAt: "2026-08-20T10:00:00Z" }),
    event({ id: "t1", type: "training", subtype: "week_completed", title: "Week 1 completed", occurredAt: "2026-07-10T10:00:00Z" }),
    event({ id: "g1", type: "goal", subtype: "goal_created", title: "Goal created", occurredAt: "2026-06-01T10:00:00Z" }),
  ];

  it("filters by kind with counts taken from the same events", () => {
    render(<DevelopmentJourneyList events={events} loading={false} />);
    expect(screen.getByRole("button", { name: /^All 7$/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^Goals 4$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Sessions 1$/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Sessions 1$/ }));
    const rows = screen.getAllByTestId("journey-event");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("Mentoring session completed");
  });

  it("buckets newest first by month, groups same-day runs, and reveals earlier months on demand", () => {
    render(<DevelopmentJourneyList events={events} loading={false} />);
    expect(screen.getAllByTestId("journey-month").map((m) => m.textContent)).toEqual([
      expect.stringContaining("September 2026"),
      expect.stringContaining("August 2026"),
    ]);
    // Three same-day completed actions collapse into one row, originals inside.
    expect(screen.getByText("3 Action updates")).toBeInTheDocument();
    expect(screen.queryByText(/Action B/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "3 items" }));
    expect(screen.getByText(/Action B/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show earlier · 2 more months" }));
    expect(screen.getAllByTestId("journey-month")).toHaveLength(4);
    expect(screen.queryByRole("button", { name: /Show earlier/ })).toBeNull();
  });

  it("never renders programme progress or requirement text — only experienced events", () => {
    render(<DevelopmentJourneyList events={events} loading={false} />);
    expect(screen.getByTestId("development-journey")).not.toHaveTextContent(/required|\d+\s*\/\s*\d+/i);
  });
});
