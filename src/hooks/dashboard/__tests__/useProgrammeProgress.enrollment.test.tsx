import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const { filters, triadScopes, rpc } = vi.hoisted(() => ({
  filters: [] as Array<[string, string, unknown]>,
  triadScopes: [] as string[],
  rpc: vi.fn(),
}));

vi.mock("@/hooks/useEnrollmentContext", () => ({
  useEnrollmentContext: () => ({
    selectedEnrollment: { id: "enrollment-history" },
    loading: false,
  }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc,
    from: (table: string) => {
      const rows = table === "assignments"
        ? [{ id: "assignment-1", training_week_id: "week-1" }]
        : table === "daily_prompts"
          ? [{ id: "prompt-1", training_week_id: "week-1", day_offset: 1 }]
          : table === "assignment_submissions"
            ? [{ assignment_id: "assignment-1", score_pct: 80 }]
            : table === "daily_prompt_responses"
              ? [{ daily_prompt_id: "prompt-1", responded_at: "2026-01-02T00:00:00Z" }]
              : [];
      const result = { data: rows, error: null };
      const query: Record<string, unknown> = {};
      query.select = () => query;
      query.eq = (column: string, value: unknown) => {
        filters.push([table, column, value]);
        return query;
      };
      query.in = () => Promise.resolve(result);
      query.or = (scope: string) => {
        triadScopes.push(scope);
        return Promise.resolve(result);
      };
      query.then = (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve);
      return query;
    },
  },
}));

import { useProgrammeProgress } from "../useProgrammeProgress";

describe("useProgrammeProgress enrollment isolation", () => {
  it("keys training shortcuts and filters learner activity by the selected enrollment", async () => {
    rpc.mockResolvedValue({
      data: [{
        id: "week-1",
        week_number: 1,
        title: "Week one",
        title_vi: null,
        subtitle: null,
        subtitle_vi: null,
        unlock_date: "2026-01-01",
        effective_unlock_date: "2026-01-01",
        locked: false,
        viewed_at: null,
        completed_at: null,
      }],
      error: null,
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useProgrammeProgress("learner-1", "enrollment-history"), { wrapper });

    await waitFor(() => expect(result.current.summary.weeksTotal).toBe(1));
    expect(client.getQueryData(["programme-training-progress", "enrollment-history"])).toBeDefined();
    expect(filters).toContainEqual(["assignment_submissions", "enrollment_id", "enrollment-history"]);
    expect(filters).toContainEqual(["daily_prompt_responses", "enrollment_id", "enrollment-history"]);
    expect(filters.some(([, column]) => column === "user_id")).toBe(false);
    expect(triadScopes).toEqual([
      "coach_enrollment_id.eq.enrollment-history,coachee_enrollment_id.eq.enrollment-history,observer_enrollment_id.eq.enrollment-history",
    ]);
  });
});
