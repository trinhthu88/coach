import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import "@/i18n/config";

const cohortId = "11111111-1111-4111-8111-111111111119";
const roster = Array.from({ length: 12 }, (_, index) => ({
  enrollment_id: `enrollment-${index + 1}`,
  learner_display_name: `Leader C${index + 1}`,
  programme_label: "Emerging Leaders",
  cohort_id: cohortId,
  cohort_label: "Emerging Leaders – Cohort C",
  enrollment_status: "at_risk",
  required_units: 16,
  completed_units: 0,
  due_units: 16,
  due_adherence_pct: 0,
  pace_status: "behind",
  coaching_required_units: 4,
  coaching_completed_count: 0,
  coaching_completed_units: 0,
  coaching_due_units: 4,
  training_required_units: 6,
  training_completed_units: 0,
  training_due_units: 6,
  peer_required_units: 2,
  peer_completed_units: 0,
  peer_due_units: 2,
  mentoring_required_units: 2,
  mentoring_completed_count: 0,
  mentoring_completed_units: 0,
  mentoring_due_units: 2,
  triad_required_units: 2,
  triad_completed_count: 0,
  triad_completed_units: 0,
  triad_due_units: 2,
  full_completion_pct: 0,
  goal_count: 0,
  open_action_count: 0,
  completed_action_count: 0,
}));

const summary = {
  cohort_id: cohortId,
  cohort_label: "Emerging Leaders – Cohort C",
  programme_label: "Emerging Leaders",
  programme_start_date: "2026-03-01",
  programme_end_date: "2026-07-05",
  enrollment_count: 12,
  suppressed: false,
  required_units: 192,
  completed_units: 0,
  due_units: 192,
  due_adherence_pct: 0,
  pace_status: "behind",
  active_count: 0,
  at_risk_count: 12,
  paused_count: 3,
  completed_count: 0,
  completed_pace_count: 0,
  ahead_count: 0,
  on_track_count: 0,
  scheduled_count: 0,
  behind_count: 12,
  not_yet_due_count: 0,
  full_completion_pct: 0,
  booked_units: 0,
  overdue_units: 79,
  schedule_coverage_pct: 0,
  on_track_pct: 0,
  coaching_completed_count: 0,
  coaching_completed_units: 0,
  training_completed_units: 0,
  peer_completed_units: 0,
  mentoring_completed_units: 0,
  triad_completed_units: 0,
  goal_count: 0,
  open_action_count: 0,
  completed_action_count: 0,
  total_action_count: 0,
  action_completion_pct: null,
  goal_setup_count: 0,
  goal_progress_pct: null,
  satisfaction_avg: null,
  satisfaction_rated_count: 0,
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string) => Promise.resolve({
      data: name === "sponsor_enrollment_summaries"
        ? roster
        : name === "sponsor_cohort_summaries"
          ? [summary]
            : name === "get_enrollment_progress"
              ? [
                { module: "coaching", completed_units: 0, due_units: 4, required_units: 4 },
                { module: "training", completed_units: 0, due_units: 6, required_units: 6 },
                { module: "peer_coaching", completed_units: 0, due_units: 2, required_units: 2 },
                { module: "mentoring", completed_units: 0, due_units: 2, required_units: 2 },
                { module: "triads", completed_units: 0, due_units: 2, required_units: 2 },
              ]
          : 5,
      error: null,
    }),
  },
}));

vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "sponsor-1" } }) }));

import SponsorCohortDetail from "../SponsorCohortDetail";

describe("Sponsor Cohort C reconciliation", () => {
  it("shows completed lifecycle and canonical module denominators in cards and roster", async () => {
    render(
      <MemoryRouter initialEntries={[`/sponsor/cohorts/${cohortId}`]}>
        <Routes>
          <Route path="/sponsor/cohorts/:cohortId" element={<SponsorCohortDetail />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText("Emerging Leaders – Cohort C")).toBeInTheDocument());
    expect(screen.getByText("Complete")).toBeInTheDocument();
    expect(screen.getByText(/Mar 1, 2026/)).toBeInTheDocument();
    expect(screen.getByText(/Jul 5, 2026/)).toBeInTheDocument();
    expect(screen.getByText("Programme complete")).toBeInTheDocument();
    expect(screen.getAllByText("0/48").length).toBeGreaterThan(0);
    expect(screen.getByText("0 of 12 leaders meet the requirement · 48 due so far")).toBeInTheDocument();
    expect(screen.getByText("Programme journey")).toBeInTheDocument();
    expect(screen.getAllByText("0/4").length).toBeGreaterThan(0);
    expect(screen.getAllByText("0/6").length).toBeGreaterThan(0);

    expect(summary.required_units).toBe(roster.reduce((total, row) => total + row.required_units, 0));
    expect(summary.due_units).toBe(roster.reduce((total, row) => total + row.due_units, 0));
    expect(summary.coaching_completed_units).toBe(0);
    expect(summary.training_completed_units).toBe(0);
    expect(summary.peer_completed_units).toBe(0);
    expect(summary.mentoring_completed_units).toBe(0);
    expect(summary.triad_completed_units).toBe(0);
    expect(summary.completed_units).toBe(roster.reduce((total, row) => total + row.completed_units, 0));
    expect(summary.completed_units).toBeLessThanOrEqual(summary.required_units);
  });
});