import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Mentoring opens to a Coach who is a Mentor -- an active cohort_mentors row
 * (is_active_cohort_mentor) -- even with no programme module of their own
 * (Prompt 9d).
 */
const state = vi.hoisted(() => ({ isMentor: false, role: "coach" as string, rpcCalls: [] as string[] }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async (name: string) => {
      state.rpcCalls.push(name);
      return { data: name === "is_active_cohort_mentor" ? state.isMentor : null, error: null };
    },
  },
}));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ role: state.role }) }));
vi.mock("../useProgrammeModules", () => ({ useProgrammeModules: () => ({ hasModule: () => false, loading: false }) }));

import { useModuleAccess } from "../useModuleAccess";

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

describe("useModuleAccess: mentoring for cohort Mentors", () => {
  beforeEach(() => {
    state.rpcCalls.length = 0;
  });

  it("opens mentoring to an active cohort Mentor without a programme module", async () => {
    state.role = "coach";
    state.isMentor = true;
    const { result } = renderHook(() => useModuleAccess("mentoring"), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.enabled).toBe(true);
  });

  it("keeps it closed to a Coach who is not a Mentor", async () => {
    state.role = "coach";
    state.isMentor = false;
    const { result } = renderHook(() => useModuleAccess("mentoring"), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.enabled).toBe(false);
  });

  it("asks nothing extra for a learner or another module", async () => {
    state.role = "coachee";
    renderHook(() => useModuleAccess("mentoring"), { wrapper });
    state.role = "coach";
    renderHook(() => useModuleAccess("training"), { wrapper });
    await new Promise((r) => setTimeout(r, 20));
    expect(state.rpcCalls).toEqual([]);
  });
});
