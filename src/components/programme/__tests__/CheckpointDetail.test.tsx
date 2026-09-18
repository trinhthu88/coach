import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { ProgrammeJourneyPoint } from "@/lib/programmeProfile";

const JOURNEY: ProgrammeJourneyPoint[] = [
  { checkpoint_number: 7, due_on: "2026-02-19", label: null, module_scope: ["coaching"], required_units: 7, completed_units: 6, state: "overdue" },
  { checkpoint_number: 8, due_on: "2026-04-05", label: null, module_scope: ["coaching", "mentoring", "peer_coaching", "triads"], required_units: 11, completed_units: 10, state: "overdue" },
  { checkpoint_number: 9, due_on: "2026-05-20", label: null, module_scope: ["coaching"], required_units: 12, completed_units: 11, state: "upcoming" },
  { checkpoint_number: 10, due_on: "2026-07-05", label: null, module_scope: ["coaching", "mentoring", "peer_coaching", "triads"], required_units: 16, completed_units: 14, state: "upcoming" },
];

vi.mock("@/hooks/useLearnerCanonicalProgress", () => ({
  useLearnerCanonicalProgress: () => ({
    progress: { programme_start_date: "2026-01-05", programme_end_date: "2026-07-05" },
    journey: JOURNEY,
    loading: false,
    error: null,
    retry: vi.fn(),
  }),
}));

import "@/i18n/config";
import { LearnerProgrammeJourney } from "../LearnerProgrammeJourney";
import { moduleScopeLabelFor } from "../profileTheme";

function renderFull() {
  return render(
    <MemoryRouter>
      <LearnerProgrammeJourney enrollmentId="e1" variant="full" />
    </MemoryRouter>
  );
}

describe("Programme Journey checkpoint detail", () => {
  it("My Journey exposes every canonical checkpoint (never truncated)", () => {
    renderFull();
    expect(screen.getAllByTestId("journey-checkpoint")).toHaveLength(4);
    expect(screen.queryByText(/Showing checkpoints/)).toBeNull();
  });

  it("titles the checkpoint by number and due date — no generated module-list title", () => {
    renderFull();
    // Focus = the next upcoming checkpoint (9).
    const detail = screen.getByTestId("checkpoint-detail");
    expect(detail).toHaveTextContent("Checkpoint 9");
    expect(within(detail).getByTestId("checkpoint-due")).toHaveTextContent("Due");
    expect(detail).not.toHaveTextContent(/coaching · |peer_coaching|mentoring · /);
  });

  it("shows modules only under Modules in scope, with user-facing labels", () => {
    renderFull();
    fireEvent.click(within(screen.getAllByTestId("journey-checkpoint")[1]).getByRole("button"));
    const detail = screen.getByTestId("checkpoint-detail");
    expect(detail).toHaveTextContent("Checkpoint 8");
    const modules = within(detail).getByTestId("checkpoint-modules");
    expect(modules.textContent).toMatch(/Coaching.*Mentoring.*Peer coaching.*Triads/);
    expect(screen.queryByText(/peer_coaching/)).toBeNull();
  });

  it("normalises module labels and never exposes enum values", () => {
    const labels: Record<string, string> = { "cohortDetail.modules.peer": "Peer coaching", "cohortDetail.modules.training": "Training / Learning" };
    const t = (key: string) => labels[key] ?? key;
    expect(moduleScopeLabelFor("peer_coaching", t)).toBe("Peer coaching");
    expect(moduleScopeLabelFor("training_learning", t)).toBe("Training / Learning");
    expect(moduleScopeLabelFor("daily_prompt", t)).toBe("Daily prompt");
  });
});
