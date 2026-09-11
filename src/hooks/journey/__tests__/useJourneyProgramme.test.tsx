import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const filters: Array<[string, unknown]> = [];
const enrollmentContext = vi.fn();

vi.mock("@/hooks/useEnrollmentContext", () => ({
  useEnrollmentContext: (...args: unknown[]) => enrollmentContext(...args),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: vi.fn().mockResolvedValue({ data: [{ monthly_limit: 4, used_this_month: 1 }], error: null }),
    from: () => {
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => {
          filters.push([column, value]);
          return query;
        },
        order: async () => ({
          data: [{
            id: "enrollment-current",
            start_date: "2026-09-01",
            end_date: "2026-12-01",
            programme_id: "programme-current",
            programmes: { name: "Current programme", coachee_session_limit: 4, duration_months: 3 },
          }],
          error: null,
        }),
        limit: async () => ({ data: [], error: null }),
        maybeSingle: async () => ({
          data: {
            id: "enrollment-history",
            start_date: "2026-01-01",
            end_date: "2026-04-01",
            programme_id: "programme-history",
            programmes: { name: "Historical programme", coachee_session_limit: 6, duration_months: 3 },
          },
          error: null,
        }),
      };
      return query;
    },
  },
}));

import { useJourneyProgramme } from "../useJourneyProgramme";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useJourneyProgramme", () => {
  beforeEach(() => {
    filters.length = 0;
    enrollmentContext.mockReset();
    enrollmentContext.mockReturnValue({
      selectedEnrollment: { id: "enrollment-history" },
      selectedEnrollmentId: "enrollment-history",
      loading: false,
    });
  });

  it("loads an explicitly selected historical enrollment by its ID", async () => {
    const { result } = renderHook(
      () => useJourneyProgramme("learner-1", "enrollment-history"),
      { wrapper }
    );

    await waitFor(() => expect(result.current.programme?.programmeName).toBe("Historical programme"));
    expect(enrollmentContext).toHaveBeenCalledWith("learner-1", "enrollment-history");
    expect(filters).toContainEqual(["id", "enrollment-history"]);
    expect(filters).not.toContainEqual(["status", "active"]);
  });
});
