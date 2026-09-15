import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import "@/i18n/config";

const cohortId = "11111111-1111-4111-8111-111111111119";
const coaching = [4, 4, 4, 3, 3, 2, 2, 1, 4, 3, 2, 0];
const training = [6, 6, 5, 4, 3, 2, 1, 0, 6, 4, 2, 1];
const peer = [2, 2, 2, 2, 1, 1, 0, 0, 2, 1, 0, 0];
const mentoring = [2, 2, 2, 1, 1, 0, 2, 0, 2, 1, 0, 0];
const triads = [2, 2, 2, 1, 1, 1, 2, 2, 2, 0, 0, 0];
const roster = Array.from({ length: 12 }, (_, index) => ({
  enrollment_id: `enrollment-${index + 1}`,
  learner_display_name: `Leader C${index + 1}`,
  programme_label: "Emerging Leaders",
  cohort_id: cohortId,
  cohort_label: "Emerging Leaders – Cohort C",
  enrollment_status: [0, 1, 2, 8].includes(index) ? "completed" : [3, 6, 10].includes(index) ? "paused" : "at_risk",
  required_units: 16,
  completed_units: coaching[index] + training[index] + peer[index] + mentoring[index] + triads[index],
  due_units: 16,
  due_adherence_pct: Math.round((coaching[index] + training[index] + peer[index] + mentoring[index] + triads[index]) * 100 / 16),
  pace_status: [0, 1, 2, 8].includes(index) ? "completed" : "behind",
  coaching_required_units: 4,
  coaching_completed_count: coaching[index],
  coaching_completed_units: coaching[index],
  coaching_due_units: 4,
  training_required_units: 6,
  training_completed_units: training[index],
  training_due_units: 6,
  peer_required_units: 2,
  peer_completed_units: peer[index],
  peer_due_units: 2,
  mentoring_required_units: 2,
  mentoring_completed_count: mentoring[index],
  mentoring_completed_units: mentoring[index],
  mentoring_due_units: 2,
  triad_required_units: 2,
  triad_completed_count: triads[index],
  triad_completed_units: triads[index],
  triad_due_units: 2,
  full_completion_pct: Math.round((coaching[index] + training[index] + peer[index] + mentoring[index] + triads[index]) * 100 / 16),
  goal_count: 1,
  open_action_count: 0,
  completed_action_count: 1,
}));

const summary = {
  cohort_id: cohortId,
  cohort_label: "Emerging Leaders – Cohort C",
  programme_label: "Emerging Leaders",
  programme_start_date: "2026-03-01",
  programme_end_date: "2026-07-05",
  programme_total_weeks: 18,
  programme_current_week: 7,
  enrollment_count: 12,
  suppressed: false,
  required_units: 192,
  completed_units: 113,
  due_units: 192,
  due_adherence_pct: 58.9,
  pace_status: "behind",
  active_count: 0,
  at_risk_count: 6,
  paused_count: 3,
  completed_count: 4,
  completed_pace_count: 4,
  ahead_count: 0,
  on_track_count: 0,
  scheduled_count: 0,
  behind_count: 8,
  not_yet_due_count: 0,
  full_completion_pct: 58.9,
  booked_units: 0,
  overdue_units: 79,
  schedule_coverage_pct: 58.9,
  on_track_pct: 0,
  coaching_completed_count: 32,
  coaching_required_per_leader: 4,
  coaching_entitled_units: 48,
  coaching_completed_units: 32,
  coaching_expected_units: 48,
  coaching_completed_leaders: 4,
  training_required_per_leader: 6,
  training_entitled_units: 72,
  training_completed_units: 40,
  training_expected_units: 72,
  training_completed_leaders: 3,
  peer_required_per_leader: 2,
  peer_entitled_units: 24,
  peer_completed_units: 13,
  peer_expected_units: 24,
  peer_completed_leaders: 4,
  mentoring_required_per_leader: 2,
  mentoring_entitled_units: 24,
  mentoring_completed_units: 13,
  mentoring_expected_units: 24,
  mentoring_completed_leaders: 5,
  triad_required_per_leader: 2,
  triad_entitled_units: 24,
  triad_completed_units: 15,
  triad_expected_units: 24,
  triad_completed_leaders: 6,
  goal_count: 12,
  open_action_count: 0,
  completed_action_count: 12,
  total_action_count: 12,
  action_completion_pct: 100,
  goal_setup_count: 0,
  goal_progress_pct: null,
  satisfaction_avg: 4,
  satisfaction_rated_count: 32,
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string) => Promise.resolve({
      data: name === "sponsor_enrollment_summaries"
        ? roster
        : name === "sponsor_cohort_summaries"
          ? [summary]
          : 5,
      error: null,
    }),
  },
}));

vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "sponsor-1" } }) }));

import SponsorCohortDetail from "../SponsorCohortDetail";

describe("Sponsor Cohort C reconciliation", () => {
  it("shows completed lifecycle and the same module denominators in cards, journey, and roster", async () => {
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
    expect(screen.getByText("Week 7 of 18")).toBeInTheDocument();
    expect(screen.getAllByText("32/48").length).toBeGreaterThan(0);
    expect(screen.getByText("4 of 12 leaders meet the requirement · 48 expected by now · 4 per leader")).toBeInTheDocument();
    expect(screen.getByText("Programme journey")).toBeInTheDocument();
    expect(screen.getAllByText("4/4").length).toBeGreaterThan(0);
    expect(screen.getAllByText("3/6").length).toBeGreaterThan(0);

    expect(summary.coaching_entitled_units).toBe(4 * roster.length);
    expect(summary.peer_entitled_units).toBe(2 * roster.length);
    expect(summary.mentoring_entitled_units).toBe(2 * roster.length);
    expect(summary.triad_entitled_units).toBe(2 * roster.length);
    expect(summary.training_entitled_units).toBe(6 * roster.length);
    expect(summary.required_units).toBe(roster.reduce((total, row) => total + row.required_units, 0));
    expect(summary.due_units).toBe(roster.reduce((total, row) => total + row.due_units, 0));
    expect(summary.coaching_completed_units).toBe(roster.reduce((total, row) => total + row.coaching_completed_units, 0));
    expect(summary.training_completed_units).toBe(roster.reduce((total, row) => total + row.training_completed_units, 0));
    expect(summary.peer_completed_units).toBe(roster.reduce((total, row) => total + row.peer_completed_units, 0));
    expect(summary.mentoring_completed_units).toBe(roster.reduce((total, row) => total + row.mentoring_completed_units, 0));
    expect(summary.triad_completed_units).toBe(roster.reduce((total, row) => total + row.triad_completed_units, 0));
    expect(summary.completed_units).toBe(roster.reduce((total, row) => total + row.completed_units, 0));
    expect(summary.completed_units).toBeLessThanOrEqual(summary.required_units);
  });
});