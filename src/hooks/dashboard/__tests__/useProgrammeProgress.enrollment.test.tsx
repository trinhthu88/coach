import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const { filters, rpc } = vi.hoisted(() => ({
  filters: [] as Array<[string, string, unknown]>,
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
      filters.push([table, "from", null]);
      const rows = table === "assignments" ? [{ id: "assignment-1", training_week_id: "week-1" }] : [];
      const result = { data: rows, error: null };
      const query: Record<string, unknown> = {};
      query.select = () => query;
      query.eq = (column: string, value: unknown) => {
        filters.push([table, column, value]);
        return query;
      };
      query.in = () => Promise.resolve(result);
      query.then = (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve);
      return query;
    },
  },
}));

import { useProgrammeProgress } from "../useProgrammeProgress";

describe("useProgrammeProgress enrollment isolation", () => {
  it("keys training shortcuts and reads the server's Training summary for the selected enrollment", async () => {
    const weeks = {
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
    };
    rpc.mockImplementation((name: string) =>
      Promise.resolve(
        name === "get_enrollment_training_weeks"
          ? weeks
          : name === "learner_training_summary"
            ? { data: [{ quiz_avg: 80, quiz_scores: [{ week_number: 1, score_pct: 80 }], reflection_streak: 1 }], error: null }
            : { data: [], error: null },
      ),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useProgrammeProgress("learner-1", "enrollment-history"), { wrapper });

    await waitFor(() => expect(result.current.summary.weeksTotal).toBe(1));
    expect(client.getQueryData(["programme-training-progress", "enrollment-history"])).toBeDefined();
    // Quiz average and the prompt streak are learner_training_summary's
    // (20261007001100), keyed to the selected enrollment -- never recomputed here.
    expect(rpc).toHaveBeenCalledWith("learner_training_summary", { p_enrollment_id: "enrollment-history" });
    expect(result.current.summary.quizAvg).toBe(80);
    expect(result.current.summary.reflectionStreak).toBe(1);
    expect(result.current.summary.quizScores).toEqual([{ weekNumber: 1, scorePct: 80 }]);
    const tablesRead = filters.filter(([, kind]) => kind === "from").map(([table]) => table);
    expect(tablesRead).not.toContain("assignment_submissions");
    expect(tablesRead).not.toContain("daily_prompt_responses");
  });
});
