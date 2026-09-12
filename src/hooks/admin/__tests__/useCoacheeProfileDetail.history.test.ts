import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fromCalls: string[] = [];

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      fromCalls.push(table);
      const results: Record<string, { data: unknown; error: null }> = {
        programme_enrollments: {
          data: [
            {
              id: "enrollment-current",
              status: "active",
              start_date: "2026-09-01",
              end_date: null,
              programmes: { name: "Current programme" },
              cohorts: { name: "Current cohort" },
            },
            {
              id: "enrollment-history",
              status: "completed",
              start_date: "2025-01-01",
              end_date: "2025-04-01",
              programmes: { name: "Historical programme" },
              cohorts: null,
            },
          ],
          error: null,
        },
        profiles: { data: { bio: null }, error: null },
        coachee_profiles: { data: null, error: null },
        coachee_goals: { data: [], error: null },
        coachee_goal_ratings: { data: [], error: null },
        sessions: { data: [], error: null },
      };
      const result = results[table];
      type Query = {
        select: () => Query;
        eq: () => Query;
        order: () => Promise<typeof result>;
        limit: () => Promise<typeof result>;
        maybeSingle: () => Promise<typeof result>;
        then: (resolve: (value: typeof result) => unknown) => Promise<unknown>;
      };
      const query = {} as Query;
      query.select = () => query;
      query.eq = () => query;
      query.order = () => Promise.resolve(result);
      query.limit = () => Promise.resolve(result);
      query.maybeSingle = () => Promise.resolve(result);
      query.then = (resolve) => Promise.resolve(result).then(resolve);
      return query;
    },
  },
}));

import { useCoacheeProfileDetail } from "../useCoacheeProfileDetail";

describe("useCoacheeProfileDetail programme history", () => {
  beforeEach(() => {
    fromCalls.length = 0;
  });

  it("loads every enrollment, including historical rows without a cohort, without a current enrollment id", async () => {
    const { result } = renderHook(() => useCoacheeProfileDetail("coachee-1"));

    await waitFor(() => expect(result.current.enrollments).toHaveLength(2));

    expect(result.current.enrollments).toEqual([
      expect.objectContaining({
        id: "enrollment-current",
        programme_name: "Current programme",
        cohort_name: "Current cohort",
        status: "active",
      }),
      expect.objectContaining({
        id: "enrollment-history",
        programme_name: "Historical programme",
        cohort_name: null,
        status: "completed",
      }),
    ]);
    expect(fromCalls).toContain("programme_enrollments");
  });
});