import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from } }));
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
  beforeEach(() => from.mockReset());

  it("resolves a completed session in a group with no configured round (the reported 'unavailable' case)", async () => {
    from.mockImplementation(
      table({
        triad_sessions: { id: "t1", status: "completed", proposed_start_time: "2026-02-16T03:00:00Z", triad_groups: LEGACY_GROUP },
        profiles: [
          { id: "learner-1", full_name: "Me", avatar_url: null },
          { id: "learner-2", full_name: "Two", avatar_url: null },
          { id: "learner-3", full_name: "Three", avatar_url: null },
        ],
        triad_reflections: [{ id: "r1" }],
      })
    );
    const { result } = renderHook(() => useTriadSessionEntry("t1"), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.entry).not.toBeNull();
    expect(result.current.entry?.round).toBeNull();
    expect(result.current.entry?.roundNumber).toBe(1);
    expect(result.current.entry?.session?.status).toBe("completed");
    expect(result.current.entry?.members.map((m) => m.full_name)).toEqual(["Me", "Two", "Three"]);
    expect(result.current.entry?.reflectionSubmitted).toBe(true);
  });

  it("returns null (not someone else's session) when the learner is not a group member", async () => {
    from.mockImplementation(
      table({
        triad_sessions: { id: "t9", status: "confirmed", triad_groups: { ...LEGACY_GROUP, member_1_id: "x", member_2_id: "y", member_3_id: "z" } },
        profiles: [],
        triad_reflections: [],
      })
    );
    const { result } = renderHook(() => useTriadSessionEntry("t9"), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.entry).toBeNull();
  });
});
