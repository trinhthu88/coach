import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { from, rpc } = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from, rpc } }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "learner-1" } }) }));

import { useTriadSessionEntry } from "../useMyTriads";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const session = (id: string, status: string, extra: Record<string, unknown> = {}) => ({
  id, session_number: id === "t1" ? 1 : 2, status, scheduled_start_time: "2026-02-16T03:00:00Z", scheduled_end_time: null, meeting_url: null,
  created_at: "2026-02-01T00:00:00Z", can_complete: false, my_response: "accepted", responses: [],
  reflection_submitted: false, reflection_satisfaction: null, pending_proposals: [], ...extra,
});

const OVERVIEW = [{
  enrollment_id: "enrollment-1", triad_group_id: "g1", cohort_requirement_date_id: "req-1", unit_number: 1, due_on: "2026-04-05", cohort_id: "c1", group_language: "en", is_active: true,
  closed_at: null, created_at: "2026-01-20T00:00:00Z", member_count: 3, my_member_slot: 1,
  // An earlier completed session and the group's later session.
  sessions: [session("t1", "completed", { reflection_submitted: true, reflection_satisfaction: 4 }), session("t2", "confirmed")],
}];

const MEMBERS = [
  { triad_group_id: "g1", member_id: "learner-3", member_slot: 3, full_name: "Three", avatar_url: null, is_self: false },
  { triad_group_id: "g1", member_id: "learner-1", member_slot: 1, full_name: "Me", avatar_url: null, is_self: true },
  { triad_group_id: "g1", member_id: "learner-2", member_slot: 2, full_name: "Two", avatar_url: null, is_self: false },
];

describe("useTriadSessionEntry", () => {
  beforeEach(() => {
    from.mockReset();
    rpc.mockReset();
    rpc.mockImplementation((fn: string) =>
      Promise.resolve({ data: fn === "learner_triad_overview" ? OVERVIEW : fn === "learner_triad_members" ? MEMBERS : null, error: null })
    );
  });

  it("resolves a completed session of the learner's Triad 1 group, with its requirement and reflection state", async () => {
    const { result } = renderHook(() => useTriadSessionEntry("t1"), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.entry?.cohortId).toBe("c1");
    expect(result.current.entry?.requirementId).toBe("req-1");
    expect(result.current.entry?.unitNumber).toBe(1);
    expect(result.current.entry?.dueOn).toBe("2026-04-05");
    expect(result.current.entry?.session?.id).toBe("t1");
    expect(result.current.entry?.session?.status).toBe("completed");
    expect(result.current.entry?.session?.reflectionSubmitted).toBe(true);
    expect(rpc).toHaveBeenCalledWith("learner_triad_overview", { p_enrollment_id: undefined });
    expect(rpc).toHaveBeenCalledWith("learner_triad_members", { p_group_ids: ["g1"] });
    expect(from).not.toHaveBeenCalled();
    expect(result.current.entry?.members.map((m) => m.full_name)).toEqual(["Me", "Two", "Three"]);
  });

  it("returns null (not someone else's session) for a session outside the learner's groups", async () => {
    const { result } = renderHook(() => useTriadSessionEntry("t9"), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.entry).toBeNull();
  });
});
