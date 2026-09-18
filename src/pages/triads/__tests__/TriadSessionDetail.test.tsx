import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { from, rpc } = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from, rpc } }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "learner-a" } }) }));

import "@/i18n/config";
import TriadSessionDetail from "../TriadSessionDetail";

function renderDetail() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/triads/t1"]}>
        <Routes>
          <Route path="/triads/:sessionId" element={<TriadSessionDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("TriadSessionDetail — co-member identity", () => {
  beforeEach(() => {
    from.mockReset();
    rpc.mockReset();
    rpc.mockImplementation((fn: string) =>
      fn === "learner_triad_overview"
        ? Promise.resolve({
            data: [{
              enrollment_id: "enrollment-a", triad_group_id: "g1", cohort_requirement_date_id: "r1", unit_number: 1, due_on: "2026-03-01",
              training_week_number: null, training_week_title: null, training_week_title_vi: null, group_language: "en", is_active: true,
              member_count: 3, my_member_slot: 1, unit_completed: true, unit_overdue: false,
              sessions: [{
                id: "t1", status: "completed", scheduled_start_time: "2026-02-16T03:00:00Z", scheduled_end_time: null, meeting_url: null,
                created_at: "2026-02-01T00:00:00Z", can_complete: false, my_response: "accepted",
                responses: [{ member_slot: 1, response: "accepted" }, { member_slot: 2, response: "accepted" }, { member_slot: 3, response: "accepted" }],
                reflection_submitted: false, reflection_satisfaction: null, pending_proposals: [],
              }],
            }],
            error: null,
          })
        : fn === "learner_triad_members"
        ? Promise.resolve({
            data: [
              { triad_group_id: "g1", member_id: "learner-a", member_slot: 1, full_name: "Alex A", avatar_url: null, is_self: true },
              { triad_group_id: "g1", member_id: "learner-b", member_slot: 2, full_name: "Bea B", avatar_url: null, is_self: false },
              { triad_group_id: "g1", member_id: "learner-c", member_slot: 3, full_name: "Cam C", avatar_url: null, is_self: false },
            ],
            error: null,
          })
        : Promise.resolve({ data: null, error: null })
    );
  });

  it("renders You plus both co-members from the canonical triad member source", async () => {
    renderDetail();
    const group = (await screen.findByText("My group")).closest("section") as HTMLElement;
    expect(within(group).getByText("You")).toBeInTheDocument();
    expect(within(group).getByText("Bea B")).toBeInTheDocument();
    expect(within(group).getByText("Cam C")).toBeInTheDocument();
    expect(rpc).toHaveBeenCalledWith("learner_triad_members", { p_group_ids: ["g1"] });
    expect(from).not.toHaveBeenCalled();
  });

  it("shows the requirement unit and its canonical due date", async () => {
    renderDetail();
    expect(await screen.findAllByText("Round 1")).not.toHaveLength(0);
    expect(screen.getByText(/Deadline Mar 1, 2026/)).toBeInTheDocument();
    expect(from).not.toHaveBeenCalled();
  });
});
