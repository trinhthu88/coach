import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Enrollment } from "@/lib/enrollments";

const state = vi.hoisted(() => ({ history: [] as Enrollment[], fail: null as Error | null }));

vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "learner-1" } }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn() } }));
vi.mock("@/lib/enrollments", async () => {
  const actual = await vi.importActual<typeof import("@/lib/enrollments")>("@/lib/enrollments");
  const history = async () => {
    if (state.fail) throw state.fail;
    return state.history;
  };
  return {
    ...actual,
    getEnrollmentHistory: history,
    getOngoingEnrollment: async () => {
      const rows = await history();
      const ongoing = rows.filter((e) => actual.isOngoingEnrollment(e.status));
      return ongoing.length === 1 ? ongoing[0] : null;
    },
  };
});

import { useActiveEnrollment } from "../useActiveEnrollment";

const enrollment = (id: string, status: Enrollment["status"], start: string): Enrollment => ({
  id, user_id: "learner-1", programme_id: "p", cohort_id: `c-${id}`, organization_id: "o", start_date: start, end_date: null, status,
});

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  state.history = [];
  state.fail = null;
});

describe("useActiveEnrollment — THE learner enrollment context", () => {
  it("resolves the one ongoing enrollment, never a historical one (Linh: Cohort B active, Cohort A completed)", async () => {
    state.history = [enrollment("cohort-b", "active", "2026-05-25"), enrollment("cohort-a", "completed", "2026-01-06")];
    const { result } = renderHook(() => useActiveEnrollment(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.enrollmentId).toBe("cohort-b");
    expect(result.current.ownEnrollmentIds).toEqual(["cohort-b", "cohort-a"]);
    expect(result.current.error).toBeNull();
  });

  it("a learner with only historical enrollments has NO active enrollment -- history is never used silently", async () => {
    state.history = [enrollment("cohort-a", "completed", "2026-01-06")];
    const { result } = renderHook(() => useActiveEnrollment(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.enrollmentId).toBeNull();
    expect(result.current.selectionState).toBe("missing");
  });

  it("two ongoing enrollments are an explicit error, not a guess", async () => {
    state.history = [enrollment("x", "active", "2026-05-25"), enrollment("y", "paused", "2026-01-06")];
    const { result } = renderHook(() => useActiveEnrollment(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.enrollmentId).toBeNull();
    expect(result.current.error).toMatch(/Multiple ongoing/);
  });

  it("a failed enrollment read surfaces as an error instead of 'no programme'", async () => {
    state.fail = new Error("permission denied for table programme_enrollments");
    const { result } = renderHook(() => useActiveEnrollment(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.error).toMatch(/permission denied/));
    expect(result.current.enrollmentId).toBeNull();
  });

  it("when the fixture's active enrollment changes, the context follows it", async () => {
    state.history = [enrollment("cohort-b", "active", "2026-05-25"), enrollment("cohort-a", "completed", "2026-01-06")];
    const { result } = renderHook(() => useActiveEnrollment(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.enrollmentId).toBe("cohort-b"));

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    state.history = [enrollment("cohort-c", "active", "2026-09-01"), enrollment("cohort-b", "completed", "2026-05-25")];
    const next = renderHook(() => useActiveEnrollment(), {
      wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });
    await waitFor(() => expect(next.result.current.enrollmentId).toBe("cohort-c"));
  });
});
