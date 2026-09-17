import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { from } = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from },
}));

import { useEnrollmentActionsSummary } from "../useEnrollmentActionsSummary";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function mockActionsTable(rows: unknown[]) {
  const calls: Array<[string, unknown]> = [];
  const query: Record<string, unknown> = {};
  query.select = () => query;
  query.eq = (col: string, val: unknown) => {
    calls.push([col, val]);
    return query;
  };
  query.neq = () => query;
  query.order = () => Promise.resolve({ data: rows, error: null });
  from.mockReturnValue(query);
  return calls;
}

describe("useEnrollmentActionsSummary", () => {
  beforeEach(() => from.mockReset());

  it("does not fetch without an enrollment id", () => {
    const { result } = renderHook(() => useEnrollmentActionsSummary(undefined), { wrapper });
    expect(result.current.total).toBe(0);
    expect(result.current.loading).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it("scopes the query to the given enrollment_id and buckets by due date and status", async () => {
    const now = new Date();
    const overdueDate = new Date(now.getTime() - 5 * 86400000).toISOString().slice(0, 10);
    const calls = mockActionsTable([
      { id: "1", title: "Overdue one", description: null, status: "open", due_date: overdueDate, goal_id: null, milestone_id: null, completed_at: null },
      { id: "2", title: "Done one", description: null, status: "completed", due_date: null, goal_id: null, milestone_id: null, completed_at: "2026-01-01" },
    ]);

    const { result } = renderHook(() => useEnrollmentActionsSummary("enrollment-1"), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(from).toHaveBeenCalledWith("enrollment_actions");
    expect(calls).toContainEqual(["enrollment_id", "enrollment-1"]);
    expect(result.current.total).toBe(2);
    expect(result.current.openCount).toBe(1);
    expect(result.current.completedCount).toBe(1);
    expect(result.current.overdue.map((a) => a.id)).toEqual(["1"]);
    expect(result.current.completed.map((a) => a.id)).toEqual(["2"]);
    expect(result.current.completionPct).toBe(50);
  });

  it("reports a null completion percentage instead of 0 when there are no actions", async () => {
    mockActionsTable([]);
    const { result } = renderHook(() => useEnrollmentActionsSummary("enrollment-1"), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.total).toBe(0);
    expect(result.current.completionPct).toBeNull();
  });
});
