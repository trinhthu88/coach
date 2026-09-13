import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import "@/i18n/config";
import i18n from "@/i18n/config";

const cohortId = "11111111-1111-4111-8111-111111111111";
const calls: string[] = [];
const responses: Record<string, unknown> = {};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (fn: string, args?: unknown) => {
      calls.push(fn);
      const data = typeof responses[fn] === "function" ? (responses[fn] as (a: unknown) => unknown)(args) : responses[fn];
      return Promise.resolve({ data, error: null });
    },
  },
}));
import SponsorCohortDetail from "../SponsorCohortDetail";

beforeEach(async () => {
  await i18n.changeLanguage("en");
  calls.length = 0;
  responses.sponsor_enrollment_summaries = [
    { enrollment_id: "e1", learner_display_name: "Priya Shah", programme_label: "Executive", cohort_id: cohortId, cohort_label: "Q3 Leaders", enrollment_status: "active", on_track: true, due_adherence_pct: 90, goal_progress_pct: 60 },
    { enrollment_id: "e2", learner_display_name: "Tom Baker", programme_label: "Executive", cohort_id: cohortId, cohort_label: "Q3 Leaders", enrollment_status: "active", on_track: false, due_adherence_pct: 70, goal_progress_pct: null },
  ];
  responses.sponsor_cohort_summaries = [{
    cohort_id: cohortId, cohort_label: "Q3 Leaders", programme_label: "Executive",
    enrollment_count: 20, suppressed: false, on_track_count: 17, assessable_count: 20, on_track_pct: 85,
    cadence_completion_pct: 91, cohort_start_date: "2026-08-01", cohort_end_date: "2026-10-24",
    cohort_status: "current", current_week: 4, total_weeks: 12,
    goal_setup_count: 15, goal_progress_pct: 58, satisfaction_avg: 4.6, satisfaction_rated_count: 18,
  }];
  responses.sponsor_min_leaders_for_distribution = 5;
  responses.sponsor_cohort_cadence_items = [];
});

describe("SponsorCohortDetail spec contract", () => {
  it("shows On Track and Cadence Completion to Date, and never the retired executive-dashboard metrics", async () => {
    render(
      <MemoryRouter initialEntries={[`/sponsor/cohorts/${cohortId}`]}>
        <Routes><Route path="/sponsor/cohorts/:cohortId" element={<SponsorCohortDetail />} /></Routes>
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText("Priya Shah")).toBeInTheDocument());

    // On Track: numerator/denominator, per spec B3.
    expect(screen.getByText("17 / 20")).toBeInTheDocument();
    // Cadence Completion to Date: an equal-weighted average, distinct from On Track.
    expect(screen.getByText("91%")).toBeInTheDocument();
    // Goals: people-count over eligible leaders, never blended with a raw goal count.
    expect(screen.getByText("15 / 20")).toBeInTheDocument();

    // Retired per spec A3/B5/E — must never reappear on this page.
    expect(screen.queryByText(/Adherence/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Coverage/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Actions complete/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Time Elapsed/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/overdue activities/i)).not.toBeInTheDocument();

    // Roster: on_track pills, not a raw completion bar.
    expect(screen.getByText("Not on track")).toBeInTheDocument();
  });

  it("links each roster row to the dedicated Leader Detail route, not a drawer", async () => {
    render(
      <MemoryRouter initialEntries={[`/sponsor/cohorts/${cohortId}`]}>
        <Routes><Route path="/sponsor/cohorts/:cohortId" element={<SponsorCohortDetail />} /></Routes>
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText("Priya Shah")).toBeInTheDocument());
    const link = screen.getByText("Priya Shah").closest("a");
    expect(link).toHaveAttribute("href", `/sponsor/cohorts/${cohortId}/leaders/e1`);
  });
});
