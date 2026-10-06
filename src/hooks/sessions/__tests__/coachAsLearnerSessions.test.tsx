import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

/**
 * A Coach enrolled as a learner sees, in the Sessions hub, the Coaching they
 * RECEIVE as well as the Coaching they give -- each row knowing which side the
 * viewer is on (Prompt 9a).
 */
const COACH = "coach-me";
const calls: Array<{ table: string; filter: string }> = [];
const rpcCalls: Array<[string, unknown]> = [];

const rows: Record<string, unknown[]> = {
  sessions: [
    { id: "given", coach_id: COACH, coachee_id: "client-1", enrollment_id: "client-enr", status: "confirmed", start_time: "2026-10-20T02:00:00Z", topic: "Given" },
    { id: "received", coach_id: "my-coach", coachee_id: COACH, enrollment_id: "my-enr", status: "confirmed", start_time: "2026-10-21T02:00:00Z", topic: "Received" },
  ],
  profiles: [
    { id: COACH, full_name: "Me" }, { id: "client-1", full_name: "Client" }, { id: "my-coach", full_name: "My Coach" },
  ],
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      const record = (filter: string) => calls.push({ table, filter });
      const query: Record<string, unknown> = {
        select: () => query,
        eq: (col: string, val: string) => { record(`eq:${col}=${val}`); return query; },
        or: (expr: string) => { record(`or:${expr}`); return query; },
        in: () => query,
        order: () => query,
        then: (resolve: (v: unknown) => void) => resolve({ data: rows[table] ?? [], error: null }),
      };
      return query;
    },
    rpc: (name: string, args: unknown) => {
      rpcCalls.push([name, args]);
      const data: Record<string, unknown[]> = {
        learner_session_history: [{ source_id: "received", requirement_unit_number: 2, requirement_due_on: "2026-10-25" }],
        learner_next_session_by_module: [{ module: "coaching", next_session_at: "2026-10-21T02:00:00Z", session_key: "k" }],
        coach_coaching_requirement_fulfilment: [{ session_id: "given", ordinal: 1, due_on: "2026-10-22" }],
      };
      return Promise.resolve({ data: data[name] ?? [], error: null });
    },
  },
}));
vi.mock("@/lib/enrollmentActions", () => ({
  withEnrollmentActions: async (list: unknown[]) => list.map((r) => ({ ...(r as object), enrollment_actions: [] })),
}));
vi.mock("@/hooks/triads/useMyTriads", () => ({ fetchMyTriads: async () => [] }));

import { useSessionsData } from "../useSessionsData";

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

describe("Sessions hub for a Coach who is also a learner", () => {
  it("loads Coaching given AND received, and marks the viewer's side of each", async () => {
    const { result } = renderHook(() => useSessionsData(COACH, "coach"), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(calls).toContainEqual({ table: "sessions", filter: `or:coach_id.eq.${COACH},coachee_id.eq.${COACH}` });
    // The Coach's own dyad sessions are loaded too.
    expect(calls.some((c) => c.table === "coachee_peer_sessions")).toBe(true);

    const byId = Object.fromEntries(result.current.sessions.map((s) => [s.id, s]));
    expect(byId.given).toMatchObject({ viewer_is_coach: true, viewer_enrollment_id: null });
    expect(byId.received).toMatchObject({ viewer_is_coach: false, viewer_enrollment_id: "my-enr" });

    // Requirement context: the session history for the Coach's own enrollment
    // (Prompt 9b), the Coach wrapper for the enrollment they coach.
    expect(rpcCalls).toContainEqual(["learner_session_history", { p_enrollment_id: "my-enr" }]);
    expect(rpcCalls).toContainEqual(["coach_coaching_requirement_fulfilment", { p_enrollment_id: "client-enr" }]);
    expect(rpcCalls.map(([name]) => name)).not.toContain("learner_coaching_requirement_fulfilment");
    expect(byId.received).toMatchObject({ requirementUnit: 2, requirementDueOn: "2026-10-25" });
    expect(byId.given).toMatchObject({ requirementUnit: 1, requirementDueOn: "2026-10-22" });
    // Next session per module, from learner_next_session_by_module.
    expect(result.current.nextSessions).toEqual([{ enrollmentId: "my-enr", module: "coaching", nextSessionAt: "2026-10-21T02:00:00Z" }]);
  });
});
