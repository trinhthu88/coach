import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";

const rpcResponses: Record<string, unknown> = {
  sponsor_kpis: [{ leaders_enrolled: 4, on_track_count: 3, at_risk_count: 1, sessions_used: 10, sessions_entitled: 32 }],
  sponsor_goal_growth_summary: [],
  sponsor_roster: [
    { enrollment_id: "e1", coachee_id: "c1", full_name: "Priya Shah", cohort_name: "Q3 Leaders", enrollment_status: "active", progress_pct: 55, sessions_completed: 4, sessions_entitled: 8, goal_growth: 22 },
    { enrollment_id: "e2", coachee_id: "c2", full_name: "Tom Baker", cohort_name: "Q4 Leaders", enrollment_status: "at_risk", progress_pct: 15, sessions_completed: 1, sessions_entitled: 8, goal_growth: -3 },
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

import SponsorCohorts from "../SponsorCohorts";

describe("SponsorCohorts", () => {
  it("renders one card per cohort, each suppressed below the leader threshold", async () => {
    render(
      <MemoryRouter>
        <SponsorCohorts />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText("Q3 Leaders")).toBeInTheDocument());
    expect(screen.getByText("Q4 Leaders")).toBeInTheDocument();

    // Each cohort here has only 1 leader, well under the threshold of 5
    expect(screen.getAllByText(/Suppressed </)).toHaveLength(2);

    // Rolled-up KPIs use the org-wide totals, not a single cohort's
    expect(screen.getByText("4")).toBeInTheDocument(); // leaders_enrolled
  });
});
