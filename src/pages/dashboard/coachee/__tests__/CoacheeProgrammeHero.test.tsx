import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

const enrollmentContext = vi.fn();
const learnerCanonicalProgress = vi.fn();

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "learner-1" }, profile: { full_name: "Jamie Learner" } }),
}));
vi.mock("@/hooks/useEnrollmentContext", () => ({
  useEnrollmentContext: (...args: unknown[]) => enrollmentContext(...args),
}));
vi.mock("@/hooks/useLearnerCanonicalProgress", () => ({
  useLearnerCanonicalProgress: (...args: unknown[]) => learnerCanonicalProgress(...args),
}));

import "@/i18n/config";
import { CoacheeProgrammeHero } from "../CoacheeProgrammeHero";

describe("CoacheeProgrammeHero", () => {
  beforeEach(() => {
    enrollmentContext.mockReset();
    learnerCanonicalProgress.mockReset();
  });

  it("shows an explicit no-enrollment notice instead of any sample programme name when there is no active enrollment", () => {
    enrollmentContext.mockReturnValue({ selectedEnrollment: null, loading: false });
    learnerCanonicalProgress.mockReturnValue({ progress: null, journey: [], loading: false });
    render(<CoacheeProgrammeHero />);
    expect(screen.getByText("Your programme details will appear here once you have an active enrollment.")).toBeInTheDocument();
    // None of the prototype's illustrative sample values may ever appear.
    expect(screen.queryByText(/Emerging Leaders/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Mai Nguyen/i)).not.toBeInTheDocument();
  });

  it("renders only the real canonical programme label, cohort and completion percentage", () => {
    enrollmentContext.mockReturnValue({ selectedEnrollment: { id: "enrollment-1" }, loading: false });
    learnerCanonicalProgress.mockReturnValue({
      progress: {
        programme_label: "Q3 Leadership Cohort",
        cohort_label: "March 2027 Intake",
        programme_start_date: "2027-03-01",
        programme_end_date: "2027-09-01",
        effective_enrollment_status: "active",
        full_completion_pct: 61,
      },
      journey: [
        { checkpoint_number: 1, due_on: "2027-03-15", label: null, module_scope: [], required_units: 1, completed_units: 1, state: "completed" },
        { checkpoint_number: 2, due_on: "2027-04-15", label: null, module_scope: [], required_units: 1, completed_units: 0, state: "current" },
      ],
      loading: false,
    });
    render(<CoacheeProgrammeHero />);
    expect(screen.getByText("Q3 Leadership Cohort")).toBeInTheDocument();
    expect(screen.getByText(/March 2027 Intake/)).toBeInTheDocument();
    expect(screen.getByText("61%")).toBeInTheDocument();
    expect(screen.getByText("Checkpoint 2 of 2")).toBeInTheDocument();
    // Never the prototype's illustrative sample data.
    expect(screen.queryByText(/Emerging Leaders/i)).not.toBeInTheDocument();
    expect(screen.queryByText("42%")).not.toBeInTheDocument();
  });
});
