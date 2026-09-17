import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import "@/i18n/config";

// This programme has no Triads requirement at all (Admin left the module
// disabled): triad_required_units is a real 0, not a missing/suppressed
// value. That must render as "not part of this programme", never as the
// misleading "0/0" a leftover completion figure would imply.
const cohortId = "22222222-2222-4222-8222-222222222222";
const roster = [{
  enrollment_id: "enrollment-1",
  learner_display_name: "Leader A1",
  programme_label: "Frontline Leaders",
  cohort_id: cohortId,
  cohort_label: "Frontline Leaders – Cohort A",
  enrollment_status: "active",
  required_units: 10,
  completed_units: 5,
  due_units: 10,
  due_adherence_pct: 50,
  pace_status: "on_track",
  coaching_required_units: 4,
  coaching_completed_units: 2,
  coaching_due_units: 4,
  training_required_units: 6,
  training_completed_units: 3,
  training_due_units: 6,
  peer_required_units: 0,
  peer_completed_units: 0,
  peer_due_units: 0,
  mentoring_required_units: 0,
  mentoring_completed_units: 0,
  mentoring_due_units: 0,
  triad_required_units: 0,
  triad_completed_units: 0,
  triad_due_units: 0,
  full_completion_pct: 50,
  goal_count: 0,
  open_action_count: 0,
  completed_action_count: 0,
}];

const summary = {
  cohort_id: cohortId,
  cohort_label: "Frontline Leaders – Cohort A",
  programme_label: "Frontline Leaders",
  programme_start_date: "2026-03-01",
  programme_end_date: "2026-07-05",
  enrollment_count: 5,
  suppressed: false,
  required_units: 50,
  completed_units: 25,
  due_units: 50,
  due_adherence_pct: 50,
  pace_status: "on_track",
  active_count: 5,
  at_risk_count: 0,
  paused_count: 0,
  completed_count: 0,
  completed_pace_count: 0,
  ahead_count: 0,
  on_track_count: 5,
  scheduled_count: 0,
  behind_count: 0,
  not_yet_due_count: 0,
  full_completion_pct: 50,
  booked_units: 0,
  overdue_units: 0,
  schedule_coverage_pct: 100,
  on_track_pct: 100,
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
  programme_journey: [],
};

const canonicalCohort = {
  ...summary,
  coaching_required_units: 20,
  coaching_completed_units: 10,
  coaching_due_units: 20,
  coaching_booked_units: 0,
  coaching_completed_leaders: 0,
  training_required_units: 30,
  training_completed_units: 15,
  training_due_units: 30,
  training_booked_units: 0,
  training_completed_leaders: 0,
  // Peer, mentoring and triads are not configured for this programme at
  // all — real zero requirements, not a data gap.
  peer_required_units: 0,
  peer_completed_units: 0,
  peer_due_units: 0,
  peer_booked_units: 0,
  peer_completed_leaders: 0,
  mentoring_required_units: 0,
  mentoring_completed_units: 0,
  mentoring_due_units: 0,
  mentoring_booked_units: 0,
  mentoring_completed_leaders: 0,
  triad_required_units: 0,
  triad_completed_units: 0,
  triad_due_units: 0,
  triad_booked_units: 0,
  triad_completed_leaders: 0,
  progress_source_complete: true,
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string) => Promise.resolve({
      data: name === "sponsor_canonical_enrollment_metadata"
        ? roster.map((row) => ({
          ...row,
          stored_enrollment_status: "active",
          effective_enrollment_status: "active",
          progress_available: true,
          coaching_booked_units: 0,
          training_booked_units: 0,
          peer_booked_units: 0,
          mentoring_booked_units: 0,
          triad_booked_units: 0,
        }))
          : name === "sponsor_canonical_cohort_progress"
            ? [canonicalCohort]
            : name === "sponsor_min_leaders_for_distribution"
              ? 5
              : undefined,
      error: null,
    }),
  },
}));

vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "sponsor-1" } }) }));

import SponsorCohortDetail from "../SponsorCohortDetail";

describe("Sponsor Cohort Detail module availability", () => {
  it("shows a disabled module as not-applicable instead of a misleading 0/0", async () => {
    render(
      <MemoryRouter initialEntries={[`/sponsor/cohorts/${cohortId}`]}>
        <Routes>
          <Route path="/sponsor/cohorts/:cohortId" element={<SponsorCohortDetail />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText("Frontline Leaders – Cohort A")).toBeInTheDocument());

    // Coaching and Training are configured and in progress: real numbers.
    // Fixture deliberately disagrees legacy (cohort-level completed_units:
    // 0 for both modules) with canonical (10 and 15) — asserting these
    // canonical figures also guards useSponsorCohortData's merge order
    // (verified this fails if the merge is reversed).
    expect(screen.getAllByText("10/20").length).toBeGreaterThan(0);
    expect(screen.getAllByText("15/30").length).toBeGreaterThan(0);

    // Peer, mentoring and triads have no requirement for this programme:
    // every occurrence must read as not-applicable, never "0/0".
    expect(screen.queryByText("0/0")).not.toBeInTheDocument();
    expect(screen.getAllByText("Not part of this programme's configuration").length).toBeGreaterThan(0);
  });
});
