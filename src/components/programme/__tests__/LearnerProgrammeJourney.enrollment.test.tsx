import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { formatProfileDate } from "@/lib/programmeProfile";

/**
 * The Programme Journey card shows the learner's OWN enrollment dates and the
 * canonical EFFECTIVE status (learner_canonical_progress), not the cohort's
 * programme dates and a lifecycle guessed from them (20261006160000).
 */
vi.mock("@/hooks/useLearnerCanonicalProgress", () => ({
  useLearnerCanonicalProgress: () => ({
    progress: {
      programme_start_date: "2026-01-05",
      programme_end_date: "2026-07-05",
      // Joined late, extended past the cohort end.
      enrollment_start_date: "2026-02-02",
      enrollment_end_date: "2026-08-31",
      effective_enrollment_status: "at_risk",
    },
    journey: [],
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

describe("LearnerProgrammeJourney enrollment header", () => {
  it("shows the enrollment's own dates and its effective status", () => {
    render(
      <MemoryRouter>
        <LearnerProgrammeJourney enrollmentId="e1" variant="summary" />
      </MemoryRouter>
    );
    expect(screen.getByText(`${formatProfileDate("2026-02-02")} – ${formatProfileDate("2026-08-31")}`)).toBeInTheDocument();
    expect(screen.getByTestId("journey-status")).toHaveTextContent("At risk");
  });
});
