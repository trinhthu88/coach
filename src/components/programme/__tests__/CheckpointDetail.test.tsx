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

vi.mock("@/hooks/useCanonicalScheduleState", () => ({
  useCanonicalScheduleState: () => ({ rows: [], mismatches: [], loading: false, error: null }),
}));

import "@/i18n/config";
import { LearnerProgrammeJourney } from "../LearnerProgrammeJourney";
import { ProgrammeJourney } from "../ProgrammeJourney";
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


describe("Required-units mismatch", () => {
  it("is shown explicitly in the shared journey (same component for every role)", () => {
    render(
      <MemoryRouter>
        <ProgrammeJourney
          journey={JOURNEY}
          start="2026-01-05"
          end="2026-07-05"
          viewer="sponsor"
          scheduleMismatches={[{ module: "coaching", required_units: 5, scheduled_units: 4, state: "missing_dates" }]}
        />
      </MemoryRouter>
    );
    expect(screen.getByTestId("schedule-mismatch")).toHaveTextContent("Coaching: 4 of 5 required units have a cohort due date");
  });
});

describe("Dashboard journey summary paging", () => {
  const twelve: ProgrammeJourneyPoint[] = Array.from({ length: 12 }, (_, i) => ({
    checkpoint_number: i + 1,
    due_on: `2026-${String(i + 1).padStart(2, "0")}-15`,
    label: null,
    module_scope: ["coaching"],
    required_units: i + 1,
    completed_units: i < 6 ? i + 1 : 6,
    state: i < 6 ? "completed" : i === 6 ? "current" : "upcoming",
  }));

  const shown = () => screen.getAllByTestId("journey-checkpoint").map((el) => within(el).getAllByText(/\d+/)[0].textContent);

  it("opens around the current checkpoint and lets the learner scroll back to CP1 in place", () => {
    render(
      <MemoryRouter>
        <ProgrammeJourney journey={twelve} start="2026-01-01" end="2026-12-31" viewer="learner" variant="summary" maxVisible={4} />
      </MemoryRouter>
    );
    expect(screen.getByText(/Showing checkpoints 6–9 of 12/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /earlier checkpoints/i }));
    expect(screen.getByText(/Showing checkpoints 2–5 of 12/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /back to the first checkpoint/i }));
    expect(screen.getByText(/Showing checkpoints 1–4 of 12/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /earlier checkpoints/i })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /later checkpoints/i }));
    fireEvent.click(screen.getByRole("button", { name: /later checkpoints/i }));
    expect(screen.getByText(/Showing checkpoints 9–12 of 12/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /later checkpoints/i })).toBeDisabled();
    expect(shown()).toHaveLength(4);
  });
});
