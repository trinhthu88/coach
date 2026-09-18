import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { from, rpc } = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from, rpc } }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "learner-a" } }) }));

import "@/i18n/config";
import TriadSessionDetail from "../TriadSessionDetail";

function table(rows: Record<string, unknown>) {
  return (name: string) => {
    const data = rows[name];
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.eq = () => q;
    q.in = () => q;
    q.order = () => q;
    q.maybeSingle = () => Promise.resolve({ data, error: null });
    q.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve);
    return q;
  };
}

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
    from.mockImplementation(
      table({
        // A round-less (legacy) group — the reported historical case.
        triad_sessions: {
          id: "t1",
          status: "completed",
          proposed_start_time: "2026-02-16T03:00:00Z",
          member_1_response: "accepted",
          member_2_response: "accepted",
          member_3_response: "accepted",
          triad_groups: { id: "g1", group_language: "en", member_1_id: "learner-a", member_2_id: "learner-b", member_3_id: "learner-c", round_number: 1, triad_rounds: null },
        },
        triad_reflections: [],
      })
    );
    rpc.mockImplementation((fn: string) =>
      fn === "learner_triad_members"
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
    expect(from.mock.calls.map(([t]) => t)).not.toContain("profiles");
  });

  it("still renders a round-less historical session (group round number, no deadline line)", async () => {
    renderDetail();
    expect(await screen.findAllByText("Round 1")).not.toHaveLength(0);
    expect(screen.queryByText(/Deadline/)).not.toBeInTheDocument();
  });
});
