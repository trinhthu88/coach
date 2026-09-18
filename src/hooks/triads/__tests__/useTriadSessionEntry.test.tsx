import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { from, rpc } = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from, rpc } }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "learner-1" } }) }));

import { useTriadSessionEntry } from "../useMyTriads";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function table(rows: Record<string, unknown>) {
  return (name: string) => {
    const data = rows[name];
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.eq = () => q;
    q.in = () => q;
    q.maybeSingle = () => Promise.resolve({ data, error: null });
    q.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve);
    return q;
  };
}

const LEGACY_GROUP = {
  id: "g1",
  group_language: "en",
  member_1_id: "learner-1",
  member_2_id: "learner-2",
  member_3_id: "learner-3",
  round_number: 1,
  triad_rounds: null,
};

describe("useTriadSessionEntry", () => {
  beforeEach(() => {
    from.mockReset();
    rpc.mockReset();
  });

  it("resolves a completed session in a group with no configured round (the reported 'unavailable' case)", async () => {
    from.mockImplementation(
      table({
        triad_sessions: { id: "t1", status: "completed", proposed_start_time: "2026-02-16T03:00:00Z", triad_groups: LEGACY_GROUP },
        triad_reflections: [{ id: "r1" }],
      })
    );
    // Members come from the canonical learner_triad_members projection (membership from triad_groups).
    rpc.mockResolvedValue({
      data: [
        { triad_group_id: "g1", member_id: "learner-3", member_slot: 3, full_name: "Three", avatar_url: null, is_self: false },
        { triad_group_id: "g1", member_id: "learner-1", member_slot: 1, full_name: "Me", avatar_url: null, is_self: true },
        { triad_group_id: "g1", member_id: "learner-2", member_slot: 2, full_name: "Two", avatar_url: null, is_self: false },
      ],
      error: null,
    });
    const { result } = renderHook(() => useTriadSessionEntry("t1"), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.entry).not.toBeNull();
    expect(result.current.entry?.round).toBeNull();
    expect(result.current.entry?.roundNumber).toBe(1);
    expect(result.current.entry?.session?.status).toBe("completed");
    expect(rpc).toHaveBeenCalledWith("learner_triad_members", { p_group_ids: ["g1"] });
    expect(from).not.toHaveBeenCalledWith("profiles");
    expect(result.current.entry?.members.map((m) => m.full_name)).toEqual(["Me", "Two", "Three"]);
    expect(result.current.entry?.reflectionSubmitted).toBe(true);
  });

  it("returns null (not someone else's session) when the learner is not a group member", async () => {
    from.mockImplementation(
      table({
        triad_sessions: { id: "t9", status: "confirmed", triad_groups: { ...LEGACY_GROUP, member_1_id: "x", member_2_id: "y", member_3_id: "z" } },
        triad_reflections: [],
      })
    );
    const { result } = renderHook(() => useTriadSessionEntry("t9"), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.entry).toBeNull();
  });
});
