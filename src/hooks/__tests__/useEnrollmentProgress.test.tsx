import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc },
}));

import { useEnrollmentProgress } from "../useEnrollmentProgress";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useEnrollmentProgress", () => {
  beforeEach(() => rpc.mockReset());

  it("does not fetch without a selected enrollment", () => {
    const { result } = renderHook(() => useEnrollmentProgress(), { wrapper });

    expect(result.current.modules).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns the authoritative module rows for the requested enrollment and date", async () => {
    const rows = [
      {
        module: "coaching",
        full_completion_pct: 25,
        due_adherence_pct: 50,
        pace_status: "behind",
        completed_units: 1,
        due_units: 2,
        required_units: 4,
        booked_units: 1,
      },
    ];
    rpc.mockResolvedValue({ data: rows, error: null });

    const { result } = renderHook(
      () => useEnrollmentProgress("enrollment-history", "2026-06-30"),
      { wrapper }
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.modules).toEqual(rows);
    expect(result.current.error).toBeNull();
    expect(rpc).toHaveBeenCalledWith("get_enrollment_progress", {
      p_enrollment_id: "enrollment-history",
      p_as_of: "2026-06-30",
    });
  });

  it("keeps historical and current enrollment results in separate cache entries", async () => {
    rpc.mockImplementation(async (_name: string, args: { p_enrollment_id: string }) => ({
      data: [{
        module: "coaching",
        full_completion_pct: args?.p_enrollment_id === "enrollment-history" ? 25 : 75,
        due_adherence_pct: 100,
        pace_status: "on_track",
        completed_units: 1,
        due_units: 1,
        required_units: 4,
        booked_units: 0,
      }],
      error: null,
    }));

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const isolatedWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result, rerender } = renderHook(
      ({ enrollmentId }) => useEnrollmentProgress(enrollmentId),
      { initialProps: { enrollmentId: "enrollment-history" }, wrapper: isolatedWrapper }
    );

    await waitFor(() => expect(result.current.modules[0]?.full_completion_pct).toBe(25));
    rerender({ enrollmentId: "enrollment-current" });
    await waitFor(() => expect(result.current.modules[0]?.full_completion_pct).toBe(75));

    expect(client.getQueryData(["enrollment-progress", "enrollment-history", null])).toMatchObject([
      { full_completion_pct: 25 },
    ]);
    expect(client.getQueryData(["enrollment-progress", "enrollment-current", null])).toMatchObject([
      { full_completion_pct: 75 },
    ]);
  });

  it("surfaces RPC errors and returns no module rows", async () => {
    const error = new Error("progress unavailable");
    rpc.mockResolvedValue({ data: null, error });

    const { result } = renderHook(() => useEnrollmentProgress("enrollment-1"), { wrapper });

    await waitFor(() => expect(result.current.error).toBe(error));
    expect(result.current.modules).toEqual([]);
  });
});
