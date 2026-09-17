import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import "@/i18n/config";
import i18n from "@/i18n/config";

const calls: string[] = [];
const cohortId = "11111111-1111-4111-8111-111111111111";
const responses: Record<string, unknown> = {
  sponsor_enrollment_summaries: [{ enrollment_id: "e1", learner_display_name: "Priya Shah", programme_label: "Executive", cohort_id: cohortId, cohort_label: "Q3 Leaders", enrollment_status: "active", required_units: 8, completed_units: 4, due_units: 4, due_adherence_pct: 100, pace_status: "on_track", coaching_completed_count: 4, mentoring_completed_count: 1, peer_completed_count: 0, triad_completed_count: 0, goal_count: 1, open_action_count: 0, completed_action_count: 0 }],
  sponsor_cohort_summaries: [{ cohort_id: cohortId, cohort_label: "Q3 Leaders", programme_label: "Executive", enrollment_count: 6, suppressed: false, required_units: 48, completed_units: 24, due_units: 24, due_adherence_pct: 100, pace_status: "on_track", coaching_completed_count: 24, mentoring_completed_count: 6, peer_completed_count: 0, triad_completed_count: 0, goal_count: 6, open_action_count: 2, completed_action_count: 4 }],
  sponsor_canonical_enrollment_progress: [{ enrollment_id: "e1", learner_display_name: "Priya Shah", programme_label: "Executive", cohort_id: cohortId, cohort_label: "Q3 Leaders", programme_id: "p1", enrollment_start_date: "2026-01-01", enrollment_end_date: "2026-12-31", programme_start_date: "2026-01-01", programme_end_date: "2026-12-31", enrollment_status: "active", stored_enrollment_status: "active", effective_enrollment_status: "active", required_units: 8, completed_units: 4, due_units: 4, booked_units: 0, overdue_units: 0, full_completion_pct: 50, due_adherence_pct: 100, pace_status: "on_track", progress_available: true, coaching_required_units: 4, coaching_completed_units: 4, coaching_due_units: 4, coaching_booked_units: 0, training_required_units: 0, training_completed_units: 0, training_due_units: 0, training_booked_units: 0, peer_required_units: 0, peer_completed_units: 0, peer_due_units: 0, peer_booked_units: 0, mentoring_required_units: 0, mentoring_completed_units: 0, mentoring_due_units: 0, mentoring_booked_units: 0, triad_required_units: 0, triad_completed_units: 0, triad_due_units: 0, triad_booked_units: 0 }],
  sponsor_canonical_cohort_progress: [{ cohort_id: cohortId, cohort_label: "Q3 Leaders", programme_label: "Executive", programme_start_date: "2026-01-01", programme_end_date: "2026-12-31", enrollment_count: 6, suppressed: false, required_units: 48, completed_units: 24, due_units: 24, booked_units: 0, overdue_units: 0, full_completion_pct: 50, due_adherence_pct: 100, schedule_coverage_pct: 100, pace_status: "on_track", progress_source_complete: true, programme_journey: [] }],
  sponsor_canonical_organisation_progress: [{ cohort_count: 1, enrollment_count: 6, required_units: 48, completed_units: 24, due_units: 24, booked_units: 0, overdue_units: 0, full_completion_pct: 50, due_adherence_pct: 100, schedule_coverage_pct: 100, overdue_units: 0, suppressed_cohort_count: 0, progress_source_complete: true }],
};
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (fn: string) => { calls.push(fn); return Promise.resolve({ data: responses[fn], error: null }); }, functions: { invoke: vi.fn() } } }));
import SponsorReport from "../SponsorReport";

beforeEach(async () => { await i18n.changeLanguage("en"); calls.length = 0; });

describe("SponsorReport privacy contract", () => {
  it("renders a request-only workflow and omits forbidden content", async () => {
    render(<MemoryRouter><SponsorReport /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Select a cohort to request a manually prepared report.")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(screen.getByText("Q3 Leaders"));
    expect(screen.getByRole("button", { name: /request report/i })).toBeEnabled();
    expect(screen.queryByText(/generate report|download|Priya Shah|confidence|satisfaction|quiz/i)).not.toBeInTheDocument();
    expect(calls).toContain("sponsor_canonical_cohort_progress");
    expect(calls).toContain("sponsor_list_report_requests");
  });
});