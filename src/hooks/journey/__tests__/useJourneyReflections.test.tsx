import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { from, enrollmentContext } = vi.hoisted(() => ({
  from: vi.fn(),
  enrollmentContext: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from },
}));
vi.mock("@/hooks/useEnrollmentContext", () => ({
  useEnrollmentContext: (...args: unknown[]) => enrollmentContext(...args),
}));

import { useJourneyReflections } from "../useJourneyReflections";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useJourneyReflections", () => {
  beforeEach(() => {
    from.mockReset();
    enrollmentContext.mockReset();
  });

  it("queries private reflections by coachee_id AND enrollment_id, not coachee_id alone", async () => {
    enrollmentContext.mockReturnValue({ selectedEnrollment: { id: "enrollment-a" }, loading: false });
    const eqCalls: Array<[string, unknown]> = [];
    const query: Record<string, unknown> = {};
    query.select = () => query;
    query.eq = (col: string, val: unknown) => {
      eqCalls.push([col, val]);
      return query;
    };
    query.order = () => Promise.resolve({ data: [{ id: "r1", enrollment_id: "enrollment-a", coachee_id: "learner-1", body: "hi", mood: null, created_at: "2026-01-01", updated_at: "2026-01-01" }] });
    from.mockReturnValue(query);

    const { result } = renderHook(() => useJourneyReflections("learner-1", "enrollment-a"), { wrapper });

    await waitFor(() => expect(result.current.reflections.length).toBe(1));
    expect(from).toHaveBeenCalledWith("coachee_reflections");
    expect(eqCalls).toContainEqual(["coachee_id", "learner-1"]);
    expect(eqCalls).toContainEqual(["enrollment_id", "enrollment-a"]);
  });

  it("does not leak enrollment B's reflections into enrollment A's query key/cache", async () => {
    const query: Record<string, unknown> = {};
    query.select = () => query;
    query.eq = () => query;
    query.order = () => Promise.resolve({ data: [] });
    from.mockReturnValue(query);

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const isolatedWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    enrollmentContext.mockReturnValue({ selectedEnrollment: { id: "enrollment-a" }, loading: false });
    const { rerender } = renderHook(
      ({ enrollmentId }: { enrollmentId: string }) => useJourneyReflections("learner-1", enrollmentId),
      { initialProps: { enrollmentId: "enrollment-a" }, wrapper: isolatedWrapper }
    );
    await waitFor(() => expect(client.getQueryData(["journey-reflections", "learner-1", "enrollment-a"])).toBeDefined());

    enrollmentContext.mockReturnValue({ selectedEnrollment: { id: "enrollment-b" }, loading: false });
    rerender({ enrollmentId: "enrollment-b" });
    await waitFor(() => expect(client.getQueryData(["journey-reflections", "learner-1", "enrollment-b"])).toBeDefined());

    // Each enrollment gets its own cache entry — never a shared/merged one.
    expect(client.getQueryData(["journey-reflections", "learner-1", "enrollment-a"])).not.toBe(
      client.getQueryData(["journey-reflections", "learner-1", "enrollment-b"])
    );
  });

  it("saves the currently selected enrollment_id on a new reflection", async () => {
    enrollmentContext.mockReturnValue({ selectedEnrollment: { id: "enrollment-a" }, loading: false });
    const selectQuery: Record<string, unknown> = {};
    selectQuery.select = () => selectQuery;
    selectQuery.eq = () => selectQuery;
    selectQuery.order = () => Promise.resolve({ data: [] });

    const insert = vi.fn().mockResolvedValue({ error: null });
    from.mockImplementation((table: string) => {
      if (table === "coachee_reflections") return { ...selectQuery, insert };
      return selectQuery;
    });

    const { result } = renderHook(() => useJourneyReflections("learner-1", "enrollment-a"), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await result.current.addReflection("A private thought", "focused");

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ coachee_id: "learner-1", enrollment_id: "enrollment-a", body: "A private thought" })
    );
  });
});
