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
};
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (fn: string) => { calls.push(fn); return Promise.resolve({ data: responses[fn], error: null }); }, functions: { invoke: vi.fn() } } }));
import SponsorReport from "../SponsorReport";

beforeEach(async () => { await i18n.changeLanguage("en"); calls.length = 0; });

describe("SponsorReport privacy contract", () => {
  it("renders only approved summary metrics and omits forbidden content", async () => {
    render(<MemoryRouter><SponsorReport /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Your one-pager previews here")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(screen.getByText("Q3 Leaders"));
    fireEvent.click(screen.getByRole("button", { name: /generate report/i }));
    await waitFor(() => expect(screen.getByText("Due adherence")).toBeInTheDocument());
    expect(screen.getByText("Priya Shah")).toBeInTheDocument();
    expect(screen.queryByText(/Goal reached|confidence|satisfaction|quiz/i)).not.toBeInTheDocument();
    expect(calls).toEqual(["sponsor_cohort_summaries", "sponsor_organisation_summary", "sponsor_min_leaders_for_distribution", "sponsor_enrollment_summaries"]);
  });
});