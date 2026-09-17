import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const learnerCanonicalProgress = vi.fn();

vi.mock("@/hooks/useLearnerCanonicalProgress", () => ({
  useLearnerCanonicalProgress: (...args: unknown[]) => learnerCanonicalProgress(...args),
}));

import "@/i18n/config";
import { ProgrammeJourneyCheckpoints } from "../ProgrammeJourneyCheckpoints";

describe("ProgrammeJourneyCheckpoints", () => {
  it("renders nothing while loading or when the programme has no configured schedule", () => {
    learnerCanonicalProgress.mockReturnValue({ journey: [], loading: false, progress: null, modules: [], experience: {}, error: null });
    const { container: empty } = render(<ProgrammeJourneyCheckpoints enrollmentId="enrollment-1" />);
    expect(empty).toBeEmptyDOMElement();

    learnerCanonicalProgress.mockReturnValue({ journey: [], loading: true, progress: null, modules: [], experience: {}, error: null });
    const { container: loading } = render(<ProgrammeJourneyCheckpoints enrollmentId="enrollment-1" />);
    expect(loading).toBeEmptyDOMElement();
  });

  it("renders real checkpoints from the canonical journey, not an invented timeline", () => {
    learnerCanonicalProgress.mockReturnValue({
      journey: [
        { checkpoint_number: 1, due_on: "2026-04-01", label: "Emerging Leaders module 1", module_scope: ["training"], required_units: 1, completed_units: 1, state: "completed" },
        { checkpoint_number: 2, due_on: "2026-05-03", label: "Emerging Leaders module 2", module_scope: ["coaching", "training"], required_units: 2, completed_units: 1, state: "overdue" },
      ],
      loading: false,
      progress: null,
      modules: [],
      experience: {},
      error: null,
    });

    render(<ProgrammeJourneyCheckpoints enrollmentId="enrollment-1" />);

    expect(screen.getByText("Programme journey")).toBeInTheDocument();
    expect(screen.getByText("Emerging Leaders module 1")).toBeInTheDocument();
    expect(screen.getByText("Emerging Leaders module 2")).toBeInTheDocument();
    expect(screen.getByText(/1\/1 complete/)).toBeInTheDocument();
    expect(screen.getByText(/1\/2 complete/)).toBeInTheDocument();
    expect(screen.getByText("Overdue")).toBeInTheDocument();
  });

  it("does not fetch when there is no enrollment id", () => {
    learnerCanonicalProgress.mockReturnValue({ journey: [], loading: false, progress: null, modules: [], experience: {}, error: null });
    render(<ProgrammeJourneyCheckpoints enrollmentId={null} />);
    expect(learnerCanonicalProgress).toHaveBeenCalledWith(undefined);
  });
});
