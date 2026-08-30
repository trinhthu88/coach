import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import "@/i18n/config";
import i18n from "@/i18n/config";

beforeEach(async () => {
  await i18n.changeLanguage("en");
});

// Mock the supabase client's rpc() so the dashboard renders from
// controlled fixture data instead of hitting the network. Each sponsor_*
// function is looked up by name. Also mock the .from("organizations")
// lookup used for the header's org name (maybeSingle, not single — a
// sponsor not yet linked to an org legitimately gets zero rows here).
const rpcResponses: Record<string, unknown> = {};
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (fn: string) => Promise.resolve({ data: rpcResponses[fn], error: null }),
    from: () => ({
      select: () => ({
        maybeSingle: async () => ({ data: { name: "Acme Corp" } }),
      }),
    }),
  },
}));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "sponsor-1" } }),
}));

import SponsorDashboard from "../SponsorDashboard";

function setMockData(overrides: Partial<typeof rpcResponses> = {}) {
  Object.assign(rpcResponses, {
    sponsor_kpis: [{ leaders_enrolled: 8, on_track_count: 6, at_risk_count: 2, sessions_used: 24, sessions_entitled: 64 }],
    sponsor_goal_growth_summary: [
      {
        avg_growth: 18.4,
        pct_progressing: 62.5,
        enrolled_leaders_count: 8,
        hit_target_count: 1,
        meaningful_progress_count: 4,
        just_started_count: 2,
        flat_declined_count: 1,
      },
    ],
    sponsor_roster: [
      {
        enrollment_id: "e1",
        coachee_id: "c1",
        full_name: "Priya Shah",
        cohort_name: "Q3 Leaders",
        enrollment_status: "active",
        progress_pct: 55,
        sessions_completed: 4,
        sessions_entitled: 8,
        goal_growth: 22,
      },
      {
        enrollment_id: "e2",
        coachee_id: "c2",
        full_name: "Tom Baker",
        cohort_name: "Q3 Leaders",
        enrollment_status: "at_risk",
        progress_pct: 15,
        sessions_completed: 1,
        sessions_entitled: 8,
        goal_growth: -3,
      },
    ],
    sponsor_satisfaction_summary: [{ avg_rating: 4.6, rated_session_count: 19 }],
    sponsor_timeline: [{ earliest_start: "2026-01-15", latest_end: "2026-12-15", programme_names: ["Executive"] }],
    sponsor_min_leaders_for_distribution: 5,
    ...overrides,
  });
}

describe("SponsorDashboard", () => {
  it("shows a loading spinner before data arrives", async () => {
    setMockData();
    const { container } = render(<SponsorDashboard />);
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
    // Let the pending fetch settle before the test ends, so React doesn't
    // warn about a state update outside act() once the promise resolves.
    await waitFor(() => expect(container.querySelector(".animate-spin")).not.toBeInTheDocument());
  });

  it("renders KPIs, roster, and the privacy notice from fetched data", async () => {
    setMockData();
    render(<SponsorDashboard />);

    await waitFor(() => expect(screen.getByText("Priya Shah")).toBeInTheDocument());

    // KPIs
    expect(screen.getByText("8")).toBeInTheDocument(); // leaders enrolled
    expect(screen.getByText("24 / 64")).toBeInTheDocument(); // sessions used/entitled

    // Roster rows, never showing goal titles/notes — just names and numbers
    expect(screen.getByText("Priya Shah")).toBeInTheDocument();
    expect(screen.getByText("Tom Baker")).toBeInTheDocument();
    expect(screen.getAllByText("Q3 Leaders")).toHaveLength(2);

    // Persistent privacy notice
    expect(
      screen.getByText(/session notes, chat messages, reflections, and the wording of goals never leave the coaching pair/i)
    ).toBeInTheDocument();

    // Goal-growth distribution is behind the "See programme details" disclosure by
    // default (progressive disclosure — see SponsorDashboard's Collapsible usage).
    fireEvent.click(screen.getByText(/see programme details/i));

    // Distribution shown (org has 8 >= 5 leaders)
    expect(screen.getByText("Hit target")).toBeInTheDocument();
    expect(screen.getByText("Meaningful progress")).toBeInTheDocument();
  });

  it("suppresses the goal-growth distribution below the minimum leader threshold", async () => {
    setMockData({
      sponsor_goal_growth_summary: [
        {
          avg_growth: 10,
          pct_progressing: 50,
          enrolled_leaders_count: 3,
          hit_target_count: null,
          meaningful_progress_count: null,
          just_started_count: null,
          flat_declined_count: null,
        },
      ],
    });
    render(<SponsorDashboard />);

    await waitFor(() => expect(screen.getByText(/see programme details/i)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/see programme details/i));

    await waitFor(() => expect(screen.getByText(/distribution hidden/i)).toBeInTheDocument());
    expect(screen.queryByText("Hit target")).not.toBeInTheDocument();
  });

  it("renders an empty-roster message when the org has no enrolled leaders", async () => {
    setMockData({
      sponsor_kpis: [{ leaders_enrolled: 0, on_track_count: 0, at_risk_count: 0, sessions_used: 0, sessions_entitled: 0 }],
      sponsor_roster: [],
      sponsor_goal_growth_summary: [],
    });
    render(<SponsorDashboard />);

    await waitFor(() => expect(screen.getByText("No leaders enrolled yet.")).toBeInTheDocument());
  });
});
