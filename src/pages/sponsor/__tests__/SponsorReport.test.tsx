import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { vi } from "vitest";
import "@/i18n/config";
import i18n from "@/i18n/config";

beforeEach(async () => {
  await i18n.changeLanguage("en");
});

const rpcResponses: Record<string, unknown> = {
  sponsor_kpis: [{ leaders_enrolled: 6, on_track_count: 5, at_risk_count: 1, sessions_used: 20, sessions_entitled: 48 }],
  sponsor_goal_growth_summary: [
    { avg_growth: 15, pct_progressing: 60, enrolled_leaders_count: 6, hit_target_count: 1, meaningful_progress_count: 3, just_started_count: 1, flat_declined_count: 1 },
  ],
  sponsor_roster: [
    { enrollment_id: "e1", coachee_id: "c1", full_name: "Priya Shah", cohort_name: "Q3 Leaders", enrollment_status: "active", progress_pct: 55, sessions_completed: 4, sessions_entitled: 8, goal_growth: 22 },
  ],
  sponsor_satisfaction_summary: [{ avg_rating: 4.6, rated_session_count: 19 }],
  sponsor_timeline: [{ earliest_start: "2026-01-15", latest_end: "2026-12-15", programme_names: ["Executive"] }],
  sponsor_min_leaders_for_distribution: 5,
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (fn: string) => Promise.resolve({ data: rpcResponses[fn], error: null }),
    from: () => ({ select: () => ({ single: async () => ({ data: { name: "Acme Corp" } }) }) }),
  },
}));
vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "sponsor-1" } }),
}));

import SponsorReport from "../SponsorReport";

describe("SponsorReport", () => {
  it("shows the preview placeholder until generated, then renders the report with the real distribution (org has >= 5 leaders)", async () => {
    render(<SponsorReport />);

    await waitFor(() => expect(screen.getByText("Your one-pager previews here")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /generate report/i }));

    await waitFor(() => expect(screen.getByText("Clariva Sponsor Summary")).toBeInTheDocument(), { timeout: 2000 });
    expect(screen.getByText("Hit target")).toBeInTheDocument();
    expect(screen.getByText("Priya Shah")).toBeInTheDocument();
    expect(
      screen.getByText(/session notes, chat messages, reflections and goal wording are excluded/i)
    ).toBeInTheDocument();
  });
});
