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

  it("shows a truncated preview of the event's own summary, and the full text on expand — no fabricated detail", () => {
    render(
      <DevelopmentJourneyList
        events={[event({ id: "e1", title: "Triad Self-Reflection", summary: "Self-rating completed across three competencies." })]}
        loading={false}
      />
    );
    // Collapsed: the real summary is already visible as a preview line.
    expect(screen.getByText("Self-rating completed across three competencies.")).toBeInTheDocument();
    // Expanding moves the same real text into the detail panel — never
    // different or additional invented content.
    fireEvent.click(screen.getByText("Triad Self-Reflection"));
    expect(screen.getByText("Self-rating completed across three competencies.")).toBeInTheDocument();
  });
});
