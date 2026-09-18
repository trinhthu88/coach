import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

const learnerCanonicalProgress = vi.fn();
vi.mock("@/hooks/useLearnerCanonicalProgress", () => ({
  useLearnerCanonicalProgress: (...args: unknown[]) => learnerCanonicalProgress(...args),
}));

import "@/i18n/config";
import { ProgrammeJourneyTimeline } from "../ProgrammeJourneyTimeline";

const point = (overrides: Partial<Record<string, unknown>>) => ({
  checkpoint_number: 1,
  due_on: "2026-09-18",
  label: null,
  module_scope: [],
  required_units: 1,
  completed_units: 0,
  state: "upcoming" as const,
  ...overrides,
});

describe("ProgrammeJourneyTimeline", () => {
  beforeEach(() => {
    learnerCanonicalProgress.mockReset();
  });

  it("shows an explicit empty state rather than a fabricated timeline when no checkpoints are configured", () => {
    learnerCanonicalProgress.mockReturnValue({ journey: [], loading: false });
    render(<ProgrammeJourneyTimeline enrollmentId="e1" />);
    expect(screen.getByText("No programme checkpoints are configured for this enrollment yet.")).toBeInTheDocument();
  });

  it("renders exactly as many checkpoints as canonically configured — never a fixed count of six", () => {
    learnerCanonicalProgress.mockReturnValue({
      journey: [
        point({ checkpoint_number: 1, label: "Getting Started", state: "completed" }),
        point({ checkpoint_number: 2, label: "Applying at Work", state: "current" }),
        point({ checkpoint_number: 3, label: "Deepening Practice", state: "upcoming" }),
        point({ checkpoint_number: 4, label: "Programme Close", state: "upcoming" }),
      ],
      loading: false,
    });
    render(<ProgrammeJourneyTimeline enrollmentId="e1" />);
    expect(screen.getByText("Getting Started")).toBeInTheDocument();
    // "Applying at Work" is the current checkpoint, so it's also
    // auto-selected into the detail panel below — appears twice.
    expect(screen.getAllByText("Applying at Work").length).toBeGreaterThan(0);
    expect(screen.getByText("Deepening Practice")).toBeInTheDocument();
    expect(screen.getByText("Programme Close")).toBeInTheDocument();
    expect(screen.getAllByText("You are here")).toHaveLength(1);
  });

  it("shows only the checkpoint's real aggregate count and module_scope — never an invented per-module breakdown", () => {
    learnerCanonicalProgress.mockReturnValue({
      journey: [
        point({
          checkpoint_number: 1,
          label: "Practising the Skills",
          state: "current",
          required_units: 9,
          completed_units: 7,
          module_scope: ["training", "coaching"],
        }),
      ],
      loading: false,
    });
    render(<ProgrammeJourneyTimeline enrollmentId="e1" />);
    // A "current" checkpoint is auto-selected into the detail panel below,
    // so its label appears both in the tile and the panel.
    fireEvent.click(screen.getAllByText("Practising the Skills")[0]);
    expect(screen.getAllByText("7/9 complete").length).toBeGreaterThan(0);
    expect(screen.getByText("Training")).toBeInTheDocument();
    expect(screen.getByText("Coaching")).toBeInTheDocument();
    // No fabricated per-module row like "Training 5/6" should appear anywhere.
    expect(screen.queryByText(/5\/6/)).not.toBeInTheDocument();
  });
});
