import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { from } = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from },
}));
vi.mock("@/lib/enrollmentActions", () => ({
  withEnrollmentActions: async (rows: unknown[]) =>
    (rows as Record<string, unknown>[]).map((r) => ({ ...r, enrollment_actions: [] })),
  saveEnrollmentActions: vi.fn(async () => ({ error: null })),
}));

import { useSessionCore } from "../useSessionCore";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useSessionCore", () => {
  let selectCallsByTable: Record<string, string[]>;

  beforeEach(() => {
    from.mockReset();
    selectCallsByTable = {};
  });

  function mockSupabaseFrom(sessionRow: Record<string, unknown>) {
    from.mockImplementation((table: string) => {
      const query: Record<string, unknown> = {};
      query.select = (fields: string) => {
        (selectCallsByTable[table] ??= []).push(fields);
        return query;
      };
      query.eq = () => query;
      query.order = () => query;
      query.in = () => Promise.resolve({ data: [], error: null });
      query.then = (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(resolve);
      query.maybeSingle = () =>
        Promise.resolve({
          data: table === "peer_sessions" || table === "sessions" || table === "coachee_peer_sessions" ? sessionRow : null,
          error: null,
        });
      return query;
    });
  }

  // Regression test: fetchSessionCore used to hardcode "provider_notes,
  // receiver_notes" for the peer_sessions branch, but that table's actual
  // columns are coach_notes/coachee_notes (per its migration and
  // getSessionFieldMap). Selecting a nonexistent column throws a Postgres
  // 42703 error, breaking every peer-coaching session detail load.
  it("selects the correct notes columns for a peer_sessions row (not provider_notes/receiver_notes)", async () => {
    mockSupabaseFrom({
      id: "p1",
      enrollment_id: "enrollment-1",
      peer_coach_id: "coach-1",
      peer_coachee_id: "coachee-1",
      topic: "Peer practice",
      start_time: "2026-09-15T10:00:00Z",
      duration_minutes: 45,
      status: "completed",
      meeting_url: null,
      coach_notes: "well done",
      coachee_notes: "learned a lot",
      cancelled_at: null,
      slot_id: null,
    });

    const { result } = renderHook(() => useSessionCore({ sessionId: "p1", isPeer: true }), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    const peerSelects = selectCallsByTable["peer_sessions"] ?? [];
    expect(peerSelects.length).toBeGreaterThan(0);
    for (const fields of peerSelects) {
      expect(fields).toContain("coach_notes");
      expect(fields).toContain("coachee_notes");
      expect(fields).not.toContain("provider_notes");
      expect(fields).not.toContain("receiver_notes");
    }
    expect(result.current.session?.coach_notes).toBe("well done");
    expect(result.current.session?.coachee_notes).toBe("learned a lot");
  });

  it("selects the correct participant/notes columns for a coachee_peer_sessions row", async () => {
    mockSupabaseFrom({
      id: "cp1",
      enrollment_id: "enrollment-1",
      peer_provider_id: "provider-1",
      peer_receiver_id: "receiver-1",
      topic: "Coachee peer practice",
      start_time: "2026-09-15T10:00:00Z",
      duration_minutes: 30,
      status: "completed",
      meeting_url: null,
      provider_notes: "great session",
      receiver_notes: "very helpful",
      cancelled_at: null,
      slot_id: null,
    });

    const { result } = renderHook(() => useSessionCore({ sessionId: "cp1", isPeer: false, isCoacheePeer: true }), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    const selects = selectCallsByTable["coachee_peer_sessions"] ?? [];
    expect(selects.length).toBeGreaterThan(0);
    for (const fields of selects) {
      expect(fields).toContain("provider_notes");
      expect(fields).toContain("receiver_notes");
    }
    expect(result.current.session?.coach_notes).toBe("great session");
    expect(result.current.session?.coachee_notes).toBe("very helpful");
  });

  it("selects the correct columns for a plain coaching session", async () => {
    mockSupabaseFrom({
      id: "s1",
      enrollment_id: "enrollment-1",
      coach_id: "coach-1",
      coachee_id: "coachee-1",
      topic: "Coaching",
      start_time: "2026-09-15T10:00:00Z",
      duration_minutes: 60,
      status: "completed",
      meeting_url: null,
      coach_notes: "notes",
      coachee_notes: "notes",
      cancelled_at: null,
      slot_id: null,
    });

    const { result } = renderHook(() => useSessionCore({ sessionId: "s1", isPeer: false }), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    const selects = selectCallsByTable["sessions"] ?? [];
    expect(selects.length).toBeGreaterThan(0);
    for (const fields of selects) {
      expect(fields).toContain("coach_notes");
      expect(fields).toContain("coachee_notes");
    }
  });
  // A session with no enrollment used to come back as null, so its detail
  // page said "session not found" for a session the user could see in their
  // list. It now loads read-only, with no programme goals or actions.
  it("loads a session with no enrollment read-only instead of returning null", async () => {
    mockSupabaseFrom({
      id: "s-unscoped",
      enrollment_id: null,
      coach_id: "coach-1",
      coachee_id: "coachee-1",
      topic: "Historical coaching",
      start_time: "2025-09-15T10:00:00Z",
      duration_minutes: 60,
      status: "completed",
      meeting_url: null,
      coach_notes: null,
      coachee_notes: null,
      cancelled_at: null,
      slot_id: null,
    });

    const { result } = renderHook(() => useSessionCore({ sessionId: "s-unscoped", isPeer: false }), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.session?.id).toBe("s-unscoped");
    expect(result.current.session?.enrollment_id).toBeNull();
    expect(result.current.session?.enrollment_actions).toEqual([]);
    expect(result.current.milestones).toEqual([]);
    // Never falls back to another enrollment's goals.
    expect(selectCallsByTable["coachee_goals"]).toBeUndefined();
  });
});
