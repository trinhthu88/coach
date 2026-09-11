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
    enrollment_count: 5, suppressed: false, required_units: 40, completed_units: 20,
    due_units: 20, due_adherence_pct: 100, pace_status: "on_track",
    coaching_completed_count: 8, mentoring_completed_count: 2, peer_completed_count: 0,
    triad_completed_count: 0, goal_count: 10, open_action_count: 2, completed_action_count: 2,
  }];
});

describe("SponsorDashboard privacy contract", () => {
  it("uses aggregate cohort data only and no forbidden metrics", async () => {
    render(<MemoryRouter><SponsorDashboard /></MemoryRouter>);
    await waitFor(() => expect(screen.queryByText("Priya Shah")).not.toBeInTheDocument());
    expect(calls).toEqual(["sponsor_cohort_summaries", "sponsor_organisation_summary", "sponsor_min_leaders_for_distribution"]);
    expect(screen.queryByText(/Goal reached|confidence|quiz/i)).not.toBeInTheDocument();
    expect(calls.some((name) => /sponsor_(kpis|roster|goal_growth|satisfaction|confidence|programme|engagement|coach)/.test(name))).toBe(false);
  });
});