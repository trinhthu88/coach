import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { from } = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from },
}));

import { useEnrollmentSessions } from "../useEnrollmentSessions";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function buildFromMock(tableData: Record<string, unknown[]>, calls: Array<[string, string, unknown]>) {
  return (table: string) => {
    const rows = tableData[table] ?? [];
    const result = { data: rows, error: null };
    const query: Record<string, unknown> = {};
    query.select = () => query;
    query.eq = (col: string, val: unknown) => {
      calls.push([table, col, val]);
      return query;
    };
    query.or = (expr: string) => {
      calls.push([table, "or", expr]);
      return query;
    };
    query.in = () => Promise.resolve(result);
    query.then = (resolve: (v: typeof result) => unknown) => Promise.resolve(result).then(resolve);
    return query;
  };
}

const ENROLLMENT = "enrollment-1";
const USER = "learner-1";

describe("useEnrollmentSessions", () => {
  let calls: Array<[string, string, unknown]>;

  beforeEach(() => {
    from.mockReset();
    calls = [];
  });

  it("returns no sessions and does not fabricate rows when a session type has no data", async () => {
    from.mockImplementation(buildFromMock({}, calls));
    const { result } = renderHook(() => useEnrollmentSessions(ENROLLMENT, USER), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.sessions).toEqual([]);
  });

  it("includes a coaching session", async () => {
    from.mockImplementation(
      buildFromMock({ sessions: [{ id: "s1", topic: "Coaching topic", status: "completed", start_time: "2026-09-15T10:00:00Z", coach_id: "coach-1" }] }, calls)
    );
    const { result } = renderHook(() => useEnrollmentSessions(ENROLLMENT, USER), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.sessions).toHaveLength(1);
    expect(result.current.sessions[0].type).toBe("coaching");
  });

  it("includes a peer coaching session", async () => {
    from.mockImplementation(
      buildFromMock({ peer_sessions: [{ id: "p1", topic: "Peer topic", status: "completed", start_time: "2026-09-25T10:00:00Z", peer_coach_id: "peer-1", peer_coachee_id: USER }] }, calls)
    );
    const { result } = renderHook(() => useEnrollmentSessions(ENROLLMENT, USER), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.sessions.map((s) => s.type)).toEqual(["peer_coaching"]);
  });

  it("includes a mentoring session", async () => {
    from.mockImplementation(
      buildFromMock({ mentoring_sessions: [{ id: "m1", topic: "Mentoring topic", status: "completed", start_time: "2026-10-08T10:00:00Z", mentor_id: "mentor-1", mentee_id: USER }] }, calls)
    );
    const { result } = renderHook(() => useEnrollmentSessions(ENROLLMENT, USER), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.sessions.map((s) => s.type)).toEqual(["mentoring"]);
  });

  it("includes a triad session with round/week context", async () => {
    from.mockImplementation(
      buildFromMock(
        {
          triad_sessions: [
            {
              id: "t1",
              status: "completed",
              start_time: "2026-10-14T10:00:00Z",
              proposed_start_time: null,
              triad_groups: { round_number: 2, triad_rounds: { title: "Round 2", training_weeks: { week_number: 4 } } },
            },
          ],
        },
        calls
      )
    );
    const { result } = renderHook(() => useEnrollmentSessions(ENROLLMENT, USER), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.sessions[0].type).toBe("triad");
    expect(result.current.sessions[0].roundLabel).toBe("Round 2");
    expect(result.current.sessions[0].trainingWeekLabel).toBe("Week 4");
  });

  it("scopes every session table to the selected enrollment (or the triad enrollment columns)", async () => {
    from.mockImplementation(buildFromMock({}, calls));
    renderHook(() => useEnrollmentSessions(ENROLLMENT, USER), { wrapper });
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(calls).toContainEqual(["sessions", "enrollment_id", ENROLLMENT]);
    expect(calls).toContainEqual(["peer_sessions", "enrollment_id", ENROLLMENT]);
    expect(calls).toContainEqual(["mentoring_sessions", "enrollment_id", ENROLLMENT]);
    expect(calls.some(([table, col]) => table === "triad_sessions" && col === "or")).toBe(true);
  });

  it("sorts sessions by start time, most recent first", async () => {
    from.mockImplementation(
      buildFromMock(
        {
          sessions: [{ id: "s1", topic: "Older", status: "completed", start_time: "2026-09-01T10:00:00Z", coach_id: "coach-1" }],
          mentoring_sessions: [{ id: "m1", topic: "Newer", status: "completed", start_time: "2026-10-01T10:00:00Z", mentor_id: "mentor-1", mentee_id: USER }],
        },
        calls
      )
    );
    const { result } = renderHook(() => useEnrollmentSessions(ENROLLMENT, USER), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.sessions.map((s) => s.sourceId)).toEqual(["m1", "s1"]);
  });

  it("does not fetch without both an enrollment id and a user id", () => {
    from.mockImplementation(buildFromMock({}, calls));
    const { result } = renderHook(() => useEnrollmentSessions(undefined, undefined), { wrapper });
    expect(result.current.sessions).toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });
});
