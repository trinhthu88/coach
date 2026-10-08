import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Enrollment } from "@/lib/enrollments";

const state = vi.hoisted(() => ({
  history: [] as Enrollment[],
  // What learner_current_enrollment() answers: the server's ongoing rule
  // (enrollment_is_ongoing), never the client's reading of status.
  current: null as string | null,
  fail: null as Error | null,
}));

vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "learner-1" } }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn() } }));
vi.mock("@/lib/enrollments", async () => {
  const actual = await vi.importActual<typeof import("@/lib/enrollments")>("@/lib/enrollments");
  return {
    ...actual,
    getEnrollmentHistory: async () => {
      if (state.fail) throw state.fail;
      return state.history;
    },
    getCurrentEnrollmentId: async () => {
      if (state.fail) throw state.fail;
      return state.current;
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
  state.current = null;
  state.fail = null;
});

describe("useActiveEnrollment — THE learner enrollment context", () => {
  it("resolves the one ongoing enrollment, never a historical one (Linh: Cohort B active, Cohort A completed)", async () => {
    state.history = [enrollment("cohort-b", "active", "2026-05-25"), enrollment("cohort-a", "completed", "2026-01-06")];
    state.current = "cohort-b";
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

  it("a PAUSED enrollment is not current: the server refuses its bookings, so no page shows it as live (audit H4)", async () => {
    state.history = [enrollment("paused", "paused", "2026-09-01")];
    state.current = null;
    const { result } = renderHook(() => useActiveEnrollment(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.enrollmentId).toBeNull();
    expect(result.current.selectionState).toBe("missing");
  });

  it("an ACTIVE enrollment past its end date is not current either: status alone never decides (audit H4)", async () => {
    state.history = [{ ...enrollment("ended", "active", "2026-01-06"), end_date: "2026-06-30" }];
    state.current = null;
    const { result } = renderHook(() => useActiveEnrollment(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.enrollmentId).toBeNull();
    expect(result.current.selectionState).toBe("missing");
  });

  it("a failed enrollment read surfaces as an error instead of 'no programme'", async () => {
    state.fail = new Error("permission denied for table programme_enrollments");
    const { result } = renderHook(() => useActiveEnrollment(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.error).toMatch(/permission denied/));
    expect(result.current.enrollmentId).toBeNull();
  });

  it("when the fixture's active enrollment changes, the context follows it", async () => {
    state.history = [enrollment("cohort-b", "active", "2026-05-25"), enrollment("cohort-a", "completed", "2026-01-06")];
    state.current = "cohort-b";
    const { result } = renderHook(() => useActiveEnrollment(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.enrollmentId).toBe("cohort-b"));

    state.current = "cohort-c";
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    state.history = [enrollment("cohort-c", "active", "2026-09-01"), enrollment("cohort-b", "completed", "2026-05-25")];
    const next = renderHook(() => useActiveEnrollment(), {
      wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });
    await waitFor(() => expect(next.result.current.enrollmentId).toBe("cohort-c"));
  });
});
