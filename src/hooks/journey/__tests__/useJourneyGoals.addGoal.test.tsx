import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { from, rpc } = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from, rpc } }));
vi.mock("@/hooks/useEnrollmentContext", () => ({
  useEnrollmentContext: () => ({ selectedEnrollment: { id: "enr-1" } }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { useJourneyGoals } from "../useJourneyGoals";

/** A select builder that resolves to an empty list. */
function emptyQuery() {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "order", "neq"]) b[m] = () => b;
  b.then = (resolve: (v: unknown) => void) => resolve({ data: [], error: null });
  return b;
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useJourneyGoals.addGoal — a goal is created with its Start and Target, in one call", () => {
  beforeEach(() => {
    from.mockReset();
    rpc.mockReset();
    from.mockImplementation(() => ({ ...emptyQuery(), insert: vi.fn(), upsert: vi.fn() }));
  });

  it("calls create_goal_with_ratings and never writes goals or ratings rows directly", async () => {
    rpc.mockResolvedValue({ data: "goal-1", error: null });
    const { result } = renderHook(() => useJourneyGoals("learner-1"), { wrapper });
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.addGoal({
        title: "Run a calm weekly planning meeting", description: null, target_date: null, start_rating: 30, target_rating: 80,
      });
    });
    expect(ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("create_goal_with_ratings", {
      p_enrollment_id: "enr-1",
      p_title: "Run a calm weekly planning meeting",
      p_description: "",
      p_target_date: null,
      p_start_rating: 30,
      p_target_rating: 80,
    });
    const writes = from.mock.results.map((r) => r.value as { insert: ReturnType<typeof vi.fn>; upsert: ReturnType<typeof vi.fn> });
    for (const w of writes) {
      expect(w.insert).not.toHaveBeenCalled();
      expect(w.upsert).not.toHaveBeenCalled();
    }
  });

  it("reports failure (and creates nothing) when the server refuses the goal", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "A goal needs a Start and a Target rating from 0 to 100", code: "22023" } });
    const { result } = renderHook(() => useJourneyGoals("learner-1"), { wrapper });
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.addGoal({ title: "No target", description: null, target_date: null, start_rating: 30, target_rating: 30 });
    });
    expect(ok).toBe(false);
  });
});
