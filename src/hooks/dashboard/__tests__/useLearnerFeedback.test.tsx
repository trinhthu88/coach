import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// A minimal fake of the Supabase query-builder chain that actually applies
// .eq(...) filters — including dotted "relation.column" filters against an
// embedded join field — against an in-memory fixture. This is what makes the
// enrollment-isolation assertions below meaningful: a hook that forgot the
// enrollment_id filter would return every row regardless of which table was
// queried, not just the ones for this test's enrollment.
function fakeSupabaseFrom(rowsByTable: Record<string, Record<string, unknown>[]>) {
  return (table: string) => {
    let rows = rowsByTable[table] ?? [];
    const builder = {
      select: () => builder,
      eq: (col: string, val: unknown) => {
        rows = rows.filter((row) => {
          if (col.includes(".")) {
            const [rel, relCol] = col.split(".");
            const relValue = row[rel] as Record<string, unknown> | undefined;
            return relValue?.[relCol] === val;
          }
          return row[col] === val;
        });
        return builder;
      },
      order: () => builder,
      limit: () => Promise.resolve({ data: rows, error: null }),
      in: (col: string, vals: unknown[]) => {
        rows = rows.filter((row) => vals.includes(row[col]));
        return Promise.resolve({ data: rows, error: null });
      },
    };
    return builder;
  };
}

const mockFrom = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => mockFrom(table) },
}));

import { useLearnerFeedback } from "../useLearnerFeedback";

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

const mentoringRow = (enrollmentId: string, id: string) => ({
  id,
  mentor_id: "mentor-1",
  overall_notes: "Great session",
  submitted_at: "2026-06-01T00:00:00Z",
  ethical_practice: null,
  coaching_mindset: null,
  maintains_agreements: null,
  trust_safety: null,
  maintains_presence: null,
  listens_actively: null,
  evokes_awareness: null,
  facilitates_growth: null,
  mentee_id: "learner-1",
  mentoring_sessions: { enrollment_id: enrollmentId },
});

describe("useLearnerFeedback — enrollment isolation", () => {
  it("does not query until both userId and enrollmentId are present", () => {
    mockFrom.mockImplementation(fakeSupabaseFrom({}));
    const { result } = renderHook(() => useLearnerFeedback("learner-1", undefined), { wrapper });
    expect(result.current.loading).toBe(false);
    expect(result.current.feedback).toEqual([]);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("returns only feedback belonging to the selected enrollment, not a different one the same learner also has", async () => {
    mockFrom.mockImplementation(
      fakeSupabaseFrom({
        mentoring_feedback: [mentoringRow("enrollment-A", "fb-a"), mentoringRow("enrollment-B", "fb-b")],
        peer_session_competency_feedback: [],
        profiles: [{ id: "mentor-1", full_name: "Mentor One" }],
      })
    );

    const { result } = renderHook(() => useLearnerFeedback("learner-1", "enrollment-A"), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.feedback).toHaveLength(1);
    expect(result.current.feedback[0].id).toBe("fb-a");
  });
});
