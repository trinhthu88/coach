import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import "@/i18n/config";
import i18n from "@/i18n/config";

const calls: string[] = [];
const responses: Record<string, unknown> = {};
const cohortId = "11111111-1111-4111-8111-111111111111";
const enrollment = (id: string, name: string, status = "active") => ({
  enrollment_id: id, learner_display_name: name, programme_label: "Executive",
  cohort_id: cohortId, cohort_label: "Q3 Leaders", enrollment_status: status,
  required_units: 8, completed_units: 4, due_units: 4, due_adherence_pct: 100,
  pace_status: status === "active" ? "on_track" : "behind",
  coaching_completed_count: 4, mentoring_completed_count: 1, peer_completed_count: 0,
  triad_completed_count: 0, goal_count: 2, open_action_count: 1, completed_action_count: 1,
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (fn: string) => { calls.push(fn); return Promise.resolve({ data: responses[fn], error: null }); },
    from: () => ({ select: () => ({ maybeSingle: async () => ({ data: { name: "Acme Corp" } }) }) }),
  },
}));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "sponsor-1" } }) }));
import SponsorDashboard from "../SponsorDashboard";

beforeEach(async () => {
  await i18n.changeLanguage("en");
  calls.length = 0;
  responses.sponsor_enrollment_summaries = [enrollment("e1", "Priya Shah"), enrollment("e2", "Tom Baker", "at_risk")];
  responses.sponsor_cohort_summaries = [{
    cohort_id: cohortId, cohort_label: "Q3 Leaders", programme_label: "Executive",
    enrollment_count: 12, suppressed: false, required_units: 192, completed_units: 113,
    due_units: 20, due_adherence_pct: 100, pace_status: "on_track",
    coaching_completed_count: 8, mentoring_completed_count: 2, peer_completed_count: 0,
    triad_completed_count: 0, goal_count: 10, open_action_count: 2, completed_action_count: 2,
  }];
  responses.sponsor_organisation_summary = [{
    cohort_count: 1, enrollment_count: 12, active_count: 0, at_risk_count: 5,
    completed_units: 113, required_units: 192,
  }];
  responses.sponsor_canonical_enrollment_progress = [
    { ...enrollment("e1", "Priya Shah"), stored_enrollment_status: "active", effective_enrollment_status: "active", progress_available: true, coaching_required_units: 4, coaching_completed_units: 4, coaching_due_units: 4, coaching_booked_units: 0, training_required_units: 2, training_completed_units: 0, training_due_units: 2, training_booked_units: 0, peer_required_units: 1, peer_completed_units: 0, peer_due_units: 1, peer_booked_units: 0, mentoring_required_units: 1, mentoring_completed_units: 0, mentoring_due_units: 1, mentoring_booked_units: 0, triad_required_units: 0, triad_completed_units: 0, triad_due_units: 0, triad_booked_units: 0 },
    { ...enrollment("e2", "Tom Baker", "at_risk"), stored_enrollment_status: "at_risk", effective_enrollment_status: "at_risk", progress_available: true, coaching_required_units: 4, coaching_completed_units: 0, coaching_due_units: 4, coaching_booked_units: 0, training_required_units: 2, training_completed_units: 0, training_due_units: 2, training_booked_units: 0, peer_required_units: 1, peer_completed_units: 0, peer_due_units: 1, peer_booked_units: 0, mentoring_required_units: 1, mentoring_completed_units: 0, mentoring_due_units: 1, mentoring_booked_units: 0, triad_required_units: 0, triad_completed_units: 0, triad_due_units: 0, triad_booked_units: 0 },
  ];
  responses.sponsor_canonical_enrollment_metadata = responses.sponsor_canonical_enrollment_progress;
  responses.sponsor_canonical_cohort_progress = [{
    ...responses.sponsor_cohort_summaries[0],
    coaching_required_units: 48, coaching_completed_units: 8, coaching_due_units: 20, coaching_booked_units: 0, coaching_completed_leaders: 2,
    training_required_units: 24, training_completed_units: 0, training_due_units: 12, training_booked_units: 0, training_completed_leaders: 0,
    peer_required_units: 12, peer_completed_units: 0, peer_due_units: 6, peer_booked_units: 0, peer_completed_leaders: 0,
    mentoring_required_units: 12, mentoring_completed_units: 2, mentoring_due_units: 6, mentoring_booked_units: 0, mentoring_completed_leaders: 1,
    triad_required_units: 0, triad_completed_units: 0, triad_due_units: 0, triad_booked_units: 0, triad_completed_leaders: 0,
    programme_journey: [], progress_source_complete: true,
  }];
  responses.sponsor_canonical_organisation_progress = [{
    cohort_count: 1, enrollment_count: 12, required_units: 192, completed_units: 113, due_units: 20, booked_units: 0,
    overdue_units: 0, full_completion_pct: 58.9, due_adherence_pct: 100, schedule_coverage_pct: 100,
    coaching_required_units: 48, coaching_completed_units: 8, coaching_due_units: 20, coaching_booked_units: 0,
    training_required_units: 24, training_completed_units: 0, training_due_units: 12, training_booked_units: 0,
    peer_required_units: 12, peer_completed_units: 0, peer_due_units: 6, peer_booked_units: 0,
    mentoring_required_units: 12, mentoring_completed_units: 2, mentoring_due_units: 6, mentoring_booked_units: 0,
    triad_required_units: 0, triad_completed_units: 0, triad_due_units: 0, triad_booked_units: 0,
    suppressed_cohort_count: 0, progress_source_complete: true,
  }];
});

describe("SponsorDashboard privacy contract", () => {
  it("uses aggregate cohort data only and no forbidden metrics", async () => {
    render(<MemoryRouter><SponsorDashboard /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Priya Shah")).toBeInTheDocument());
    expect(screen.getByText("Tom Baker")).toBeInTheDocument();
    expect(screen.getAllByText("Units used").length).toBeGreaterThan(0);
    expect(screen.getByText("113/192")).toBeInTheDocument();
    expect(screen.queryByText("Booked / overdue")).not.toBeInTheDocument();
    expect(screen.queryByText("Goals setup / total")).not.toBeInTheDocument();
    expect(calls).toEqual([
      "sponsor_canonical_cohort_progress",
      "sponsor_canonical_organisation_progress",
      "sponsor_min_leaders_for_distribution",
      "sponsor_canonical_enrollment_metadata",
    ]);
    expect(screen.queryByText(/Goal reached|confidence|quiz/i)).not.toBeInTheDocument();
    expect(calls.some((name) => /sponsor_(kpis|roster|goal_growth|satisfaction|confidence|programme|engagement|coach)/.test(name))).toBe(false);
  });

  it("uses the canonical cohort and organisation values without legacy merges", async () => {
    render(<MemoryRouter><SponsorDashboard /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Priya Shah")).toBeInTheDocument());
    expect(screen.getByText("113 / 192")).toBeInTheDocument();
    expect(screen.getByText("113/192")).toBeInTheDocument();
    expect(calls).not.toContain("sponsor_cohort_summaries");
    expect(calls).not.toContain("sponsor_organisation_summary");
  });
});