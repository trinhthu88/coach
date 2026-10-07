import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import "@/i18n/config";

const state = vi.hoisted(() => ({
  referrals: [] as Record<string, unknown>[],
  newLearner: null as { id: string } | null,
  invoke: vi.fn(),
}));

// A small chainable query builder: each table answers from the fixture above.
function query(table: string) {
  const filters: Record<string, unknown> = {};
  const result = () => {
    if (table === "access_requests") return { data: state.referrals, error: null };
    if (table === "programmes") return { data: [{ id: "prog-1", name: "Executive Coaching" }], error: null };
    if (table === "profiles" && filters.inCol === "id") return { data: [{ id: "coach-1", full_name: "Coach Hoa" }], error: null };
    if (table === "profiles" && filters.inCol === "email") return { data: [{ id: "learner-approved", email: "an@example.test" }], error: null };
    return { data: [], error: null };
  };
  const q: Record<string, unknown> = {};
  for (const m of ["select", "not", "order"]) q[m] = () => q;
  q.in = (col: string) => { filters.inCol = col; return q; };
  q.eq = () => q;
  q.maybeSingle = () => Promise.resolve({ data: state.newLearner, error: null });
  q.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve);
  return q;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (t: string) => query(t), functions: { invoke: (...a: unknown[]) => state.invoke(...a) } },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// The dialog itself is covered elsewhere; here we only need what it starts from.
vi.mock("@/pages/admin/cohorts/NewCoachingEngagementDialog", () => ({
  NewCoachingEngagementDialog: ({ open, initial }: { open: boolean; initial?: unknown }) =>
    open ? <pre data-testid="engagement-start">{JSON.stringify(initial)}</pre> : null,
}));

import { CoachReferrals } from "../CoachReferrals";

const referral = (patch: Record<string, unknown>) => ({
  id: "req-1", full_name: "Nguyen An", email: "An@example.test", status: "approved", created_at: "2026-10-01T00:00:00Z",
  motivation: null, referred_by_coach_id: "coach-1", suggested_programme_id: "prog-1", ...patch,
});

describe("Admin -> Registrations: referrals from Coaches", () => {
  beforeEach(() => {
    state.invoke.mockReset();
    state.newLearner = null;
  });

  it("shows who referred the person and the suggested programme", async () => {
    state.referrals = [referral({})];
    render(<CoachReferrals />);
    await waitFor(() => expect(screen.getByText("Nguyen An")).toBeInTheDocument());
    expect(screen.getByText("Coach Hoa")).toBeInTheDocument();
    expect(screen.getByText("Executive Coaching")).toBeInTheDocument();
  });

  it("starts a coaching engagement from an approved referral, with learner, Coach and programme filled in", async () => {
    state.referrals = [referral({})];
    render(<CoachReferrals />);
    fireEvent.click(await screen.findByRole("button", { name: /New coaching engagement/ }));
    expect(JSON.parse(screen.getByTestId("engagement-start").textContent!)).toEqual({
      learnerId: "learner-approved", coachId: "coach-1", programmeId: "prog-1",
    });
    expect(state.invoke).not.toHaveBeenCalled();
  });

  it("approves a pending referral first, then starts the engagement for the new account", async () => {
    state.referrals = [referral({ status: "pending" })];
    state.newLearner = { id: "learner-new" };
    state.invoke.mockResolvedValue({ data: { email: "an@example.test" }, error: null });
    render(<CoachReferrals />);
    fireEvent.click(await screen.findByRole("button", { name: /Approve & start engagement/ }));
    await waitFor(() => expect(screen.getByTestId("engagement-start")).toBeInTheDocument());
    expect(state.invoke).toHaveBeenCalledWith("approve-access-request", { body: { request_id: "req-1" } });
    expect(JSON.parse(screen.getByTestId("engagement-start").textContent!)).toEqual({
      learnerId: "learner-new", coachId: "coach-1", programmeId: "prog-1",
    });
  });
});
