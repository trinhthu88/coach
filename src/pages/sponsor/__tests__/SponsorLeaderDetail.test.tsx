import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import "@/i18n/config";
import i18n from "@/i18n/config";

const cohortId = "11111111-1111-4111-8111-111111111111";
const enrollmentId = "e1";
const calls: string[] = [];
const responses: Record<string, unknown> = {};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (fn: string) => { calls.push(fn); return Promise.resolve({ data: responses[fn], error: null }); },
  },
}));
import SponsorLeaderDetail from "../SponsorLeaderDetail";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/sponsor/cohorts/${cohortId}/leaders/${enrollmentId}`]}>
      <Routes>
        <Route path="/sponsor/cohorts/:cohortId/leaders/:enrollmentId" element={<SponsorLeaderDetail />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  calls.length = 0;
  responses.sponsor_leader_cadence_items = [];
  responses.sponsor_leader_programme_history = [];
  responses.sponsor_enrollment_next_session = null;
  responses.sponsor_min_leaders_for_distribution = 5;
});

describe("SponsorLeaderDetail — cohort/leader consistency contract", () => {
  it("shows exactly the same On Track / Cadence to Date / Goal Progress values the Cohort roster already computed", async () => {
    // Same shape the Cohort roster consumes -- this test asserts the Leader
    // page performs NO second calculation, per spec: "Do NOT implement new
    // independent calculations for the Leader page."
    responses.sponsor_enrollment_summaries = [{
      enrollment_id: enrollmentId, learner_display_name: "Trang Trinh",
      programme_label: "TASC Level 1", cohort_label: "TASC Essential – Sep 2026",
      enrollment_status: "active", on_track: true, due_adherence_pct: 90, goal_progress_pct: 60,
      goal_setup_count: 2, programme_start_date: "2026-08-01", programme_end_date: "2026-10-24",
      due_units: 10, completed_units: 9, session_due_units: 2, session_completed_units: 2,
      session_required_units: 6, satisfaction_avg: 4.7, satisfaction_rated_count: 3,
    }];

    renderPage();
    await waitFor(() => expect(screen.getByText("Trang Trinh")).toBeInTheDocument());

    expect(calls).toContain("sponsor_enrollment_summaries");
    expect(screen.getByText("On track")).toBeInTheDocument();
    expect(screen.getByText("90%")).toBeInTheDocument();
    expect(screen.getByText("60%")).toBeInTheDocument();
    // Below the k-anonymity floor (3 responses) -- Satisfaction stays hidden
    // rather than showing an ambiguous score.
    expect(screen.queryByText(/4.7 \/ 5/)).not.toBeInTheDocument();
  });

  it("never displays at_risk as an enrollment status in the header, but keeps the On Track signal accurate", async () => {
    responses.sponsor_enrollment_summaries = [{
      enrollment_id: enrollmentId, learner_display_name: "Claire Dubois",
      programme_label: "TASC Level 1", cohort_label: "TASC Essential – Sep 2026",
      enrollment_status: "at_risk", on_track: false, due_adherence_pct: 70, goal_progress_pct: null,
      goal_setup_count: 0, programme_start_date: "2026-08-01", programme_end_date: "2026-10-24",
      due_units: 10, completed_units: 7, session_due_units: 2, session_completed_units: 1,
      session_required_units: 6, satisfaction_avg: null, satisfaction_rated_count: 0,
    }];

    renderPage();
    await waitFor(() => expect(screen.getByText("Claire Dubois")).toBeInTheDocument());

    expect(screen.queryByText(/at.risk/i)).not.toBeInTheDocument();
    expect(screen.getAllByText("Active").length).toBeGreaterThan(0);
    expect(screen.getByText("Not on track")).toBeInTheDocument();
  });

  it("shows On Track as — (never Not On Track) for a paused enrollment", async () => {
    responses.sponsor_enrollment_summaries = [{
      enrollment_id: enrollmentId, learner_display_name: "Yuki Tanaka",
      programme_label: "TASC Level 1", cohort_label: "TASC Essential – Sep 2026",
      enrollment_status: "paused", on_track: null, due_adherence_pct: 70, goal_progress_pct: 30,
      goal_setup_count: 1, programme_start_date: "2026-08-01", programme_end_date: "2026-10-24",
      due_units: 10, completed_units: 7, session_due_units: 2, session_completed_units: 1,
      session_required_units: 6, satisfaction_avg: null, satisfaction_rated_count: 0,
    }];

    renderPage();
    await waitFor(() => expect(screen.getByText("Yuki Tanaka")).toBeInTheDocument());

    expect(screen.getAllByText("Paused").length).toBeGreaterThan(0);
    expect(screen.queryByText("Not on track")).not.toBeInTheDocument();
    expect(screen.queryByText("On track")).not.toBeInTheDocument();
  });
});
