import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import "@/i18n/config";
import i18n from "@/i18n/config";

const calls: string[] = [];
const id1 = "11111111-1111-4111-8111-111111111111";
const id2 = "22222222-2222-4222-8222-222222222222";
const rows = (id: string, label: string) => [{ enrollment_id: `e-${id}`, learner_display_name: "Priya Shah", programme_label: "Executive", cohort_id: id, cohort_label: label, enrollment_status: "active", required_units: 8, completed_units: 4, due_units: 4, due_adherence_pct: 100, pace_status: "on_track", coaching_completed_count: 4, mentoring_completed_count: 0, peer_completed_count: 0, triad_completed_count: 0, goal_count: 1, open_action_count: 0, completed_action_count: 0 }];
const responses: Record<string, unknown> = {};
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (fn: string) => { calls.push(fn); return Promise.resolve({ data: responses[fn], error: null }); } } }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "sponsor-1" } }) }));
import SponsorCohorts from "../SponsorCohorts";

beforeEach(async () => {
  await i18n.changeLanguage("en"); calls.length = 0;
  responses.sponsor_enrollment_summaries = [...rows(id1, "Small cohort"), ...rows(id2, "Another cohort")];
  responses.sponsor_cohort_summaries = [
    { cohort_id: id1, cohort_label: "Small cohort", programme_label: "Executive", enrollment_count: null, suppressed: true },
    { cohort_id: id2, cohort_label: "Another cohort", programme_label: "Executive", enrollment_count: null, suppressed: true },
  ];
});

describe("SponsorCohorts privacy contract", () => {
  it("uses UUID links and explicitly shows suppression for small cohorts", async () => {
    render(<MemoryRouter><SponsorCohorts /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Small cohort")).toBeInTheDocument());
    expect(screen.getAllByText("Suppressed")).toHaveLength(2);
    expect(screen.queryByText(/enrollments/)).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /View cohort/i })[0]).toHaveAttribute("href", `/sponsor/cohorts/${id1}`);
    expect(calls.every((name) => name === "sponsor_enrollment_summaries" || name === "sponsor_cohort_summaries")).toBe(true);
  });
});