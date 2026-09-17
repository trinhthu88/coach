import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { from } = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from },
}));

import { useEnrollmentDevelopmentJourney } from "../useEnrollmentDevelopmentJourney";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** Records every .eq()/.or()/.in() call per table and resolves with the
 * table's canned rows once the query chain terminates. */
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
    query.in = (col: string, val: unknown) => {
      calls.push([table, "in", { col, val }]);
      return Promise.resolve(result);
    };
    query.not = () => query;
    query.then = (resolve: (v: typeof result) => unknown) => Promise.resolve(result).then(resolve);
    return query;
  };
}

const ENROLLMENT = "enrollment-1";
const COACHEE = "learner-1";

describe("useEnrollmentDevelopmentJourney", () => {
  let calls: Array<[string, string, unknown]>;

  beforeEach(() => {
    from.mockReset();
    calls = [];
  });

  it("returns an empty timeline, not fabricated events, when nothing exists", async () => {
    from.mockImplementation(buildFromMock({}, calls));
    const { result } = renderHook(() => useEnrollmentDevelopmentJourney(ENROLLMENT, COACHEE), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.events).toEqual([]);
  });

  it("scopes every source table query to the selected enrollment_id", async () => {
    from.mockImplementation(buildFromMock({}, calls));
    renderHook(() => useEnrollmentDevelopmentJourney(ENROLLMENT, COACHEE), { wrapper });
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));

    const scopedTables = [
      "coachee_goals",
      "coachee_milestones",
      "goal_checkins",
      "enrollment_actions",
      "sessions",
      "peer_sessions",
      "mentoring_sessions",
      "training_progress",
      "assignment_submissions",
      "reflection_submissions",
      "coachee_reflections",
    ];
    for (const table of scopedTables) {
      expect(calls).toContainEqual([table, "enrollment_id", ENROLLMENT]);
    }
    expect(calls.some(([table, col]) => table === "triad_sessions" && col === "or")).toBe(true);
  });

  it("produces a goal-created event and a milestone-completed event from real rows", async () => {
    from.mockImplementation(
      buildFromMock(
        {
          coachee_goals: [{ id: "g1", title: "Improve delegation", status: "active", created_at: "2026-09-12T00:00:00Z" }],
          coachee_milestones: [
            { id: "m1", goal_id: "g1", title: "Hold weekly 1:1s", is_done: true, done_at: "2026-09-20T00:00:00Z", created_at: "2026-09-12T00:00:00Z" },
          ],
        },
        calls
      )
    );
    const { result } = renderHook(() => useEnrollmentDevelopmentJourney(ENROLLMENT, COACHEE), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    const types = result.current.events.map((e) => e.subtype);
    expect(types).toContain("goal_created");
    expect(types).toContain("milestone_created");
    expect(types).toContain("milestone_completed");
  });

  it("produces a goal check-in event from goal_checkins", async () => {
    from.mockImplementation(
      buildFromMock(
        { goal_checkins: [{ id: "c1", goal_id: "g1", source_activity_type: "coaching", source_activity_id: "s1", new_rating: 56, note: null, created_at: "2026-09-15T00:00:00Z" }] },
        calls
      )
    );
    const { result } = renderHook(() => useEnrollmentDevelopmentJourney(ENROLLMENT, COACHEE), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.events.some((e) => e.subtype === "goal_checkin")).toBe(true);
  });

  it("produces action-created and action-completed events only from enrollment_actions", async () => {
    from.mockImplementation(
      buildFromMock(
        {
          enrollment_actions: [
            { id: "a1", title: "Send follow-up", status: "completed", goal_id: null, milestone_id: null, created_at: "2026-09-15T00:00:00Z", completed_at: "2026-09-19T00:00:00Z" },
          ],
        },
        calls
      )
    );
    const { result } = renderHook(() => useEnrollmentDevelopmentJourney(ENROLLMENT, COACHEE), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    const subtypes = result.current.events.map((e) => e.subtype);
    expect(subtypes).toContain("action_created");
    expect(subtypes).toContain("action_completed");
    expect(result.current.events.every((e) => e.sourceType === "enrollment_actions")).toBe(true);
  });

  it("produces a coaching event and a distinct coaching-reflection event from coachee_notes", async () => {
    from.mockImplementation(
      buildFromMock(
        { sessions: [{ id: "s1", topic: "Delegation coaching", status: "completed", start_time: "2026-09-15T10:00:00Z", coachee_notes: "Felt confident delegating this week." }] },
        calls
      )
    );
    const { result } = renderHook(() => useEnrollmentDevelopmentJourney(ENROLLMENT, COACHEE), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.events.find((e) => e.type === "coaching")?.subtype).toBe("session_completed");
    expect(result.current.events.find((e) => e.subtype === "coaching_reflection")?.summary).toBe("Felt confident delegating this week.");
  });

  it("does not create a coaching session event for a scheduled (not completed) session", async () => {
    from.mockImplementation(
      buildFromMock({ sessions: [{ id: "s2", topic: "Upcoming", status: "confirmed", start_time: "2026-10-01T10:00:00Z", coachee_notes: null }] }, calls)
    );
    const { result } = renderHook(() => useEnrollmentDevelopmentJourney(ENROLLMENT, COACHEE), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.events).toEqual([]);
  });

  it("produces a peer coaching event and a peer competency feedback event", async () => {
    from.mockImplementation(
      buildFromMock(
        {
          peer_sessions: [{ id: "p1", topic: "Peer session", status: "completed", start_time: "2026-09-25T10:00:00Z" }],
          peer_session_competency_feedback: [{ id: "pf1", peer_session_id: "p1", feedback_note: "Great listening.", created_at: "2026-09-25T11:00:00Z" }],
        },
        calls
      )
    );
    const { result } = renderHook(() => useEnrollmentDevelopmentJourney(ENROLLMENT, COACHEE), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.events.some((e) => e.type === "peer_coaching")).toBe(true);
    expect(result.current.events.some((e) => e.subtype === "peer_competency_feedback")).toBe(true);
  });

  it("produces mentoring session, mentee-reflection, and mentor-feedback events", async () => {
    from.mockImplementation(
      buildFromMock(
        {
          mentoring_sessions: [{ id: "ms1", topic: "Mentoring", status: "completed", start_time: "2026-10-08T10:00:00Z", mentee_notes: "Learned a lot." }],
          mentoring_feedback: [{ id: "mf1", mentoring_session_id: "ms1", overall_notes: "Strong presence.", submitted_at: "2026-10-08T11:00:00Z" }],
        },
        calls
      )
    );
    const { result } = renderHook(() => useEnrollmentDevelopmentJourney(ENROLLMENT, COACHEE), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    const subtypes = result.current.events.map((e) => e.subtype);
    expect(subtypes).toContain("session_completed");
    expect(subtypes).toContain("mentoring_reflection");
    expect(subtypes).toContain("mentoring_feedback");
  });

  it("produces a triad event only for a completed session", async () => {
    from.mockImplementation(
      buildFromMock(
        {
          triad_sessions: [
            { id: "t1", status: "completed", start_time: "2026-10-14T10:00:00Z", proposed_start_time: null, triad_groups: null },
            { id: "t2", status: "confirmed", start_time: null, proposed_start_time: "2026-11-01T10:00:00Z", triad_groups: null },
          ],
        },
        calls
      )
    );
    const { result } = renderHook(() => useEnrollmentDevelopmentJourney(ENROLLMENT, COACHEE), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.events.filter((e) => e.type === "triad")).toHaveLength(1);
    expect(result.current.events[0].sourceId).toBe("t1");
  });

  it("enriches a triad event with configured week/round context when the canonical relationship resolves one", async () => {
    from.mockImplementation(
      buildFromMock(
        {
          triad_sessions: [
            {
              id: "t1",
              status: "completed",
              start_time: "2026-10-14T10:00:00Z",
              proposed_start_time: null,
              triad_groups: { round_number: 2, triad_rounds: { title: "Round 2: Delegation practice", training_weeks: { week_number: 4 } } },
            },
          ],
        },
        calls
      )
    );
    const { result } = renderHook(() => useEnrollmentDevelopmentJourney(ENROLLMENT, COACHEE), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    const triadEvent = result.current.events.find((e) => e.type === "triad");
    expect(triadEvent?.title).toBe("Triad — Week 4 / Round 2");
    expect(triadEvent?.summary).toBe("Round 2: Delegation practice");
  });

  it("falls back to the generic title when only a round number resolves, and never fabricates one when nothing resolves", async () => {
    from.mockImplementation(
      buildFromMock(
        {
          triad_sessions: [
            {
              id: "t1",
              status: "completed",
              start_time: "2026-10-14T10:00:00Z",
              proposed_start_time: null,
              triad_groups: { round_number: 3, triad_rounds: { title: "Round 3", training_weeks: null } },
            },
            {
              id: "t2",
              status: "completed",
              start_time: "2026-10-20T10:00:00Z",
              proposed_start_time: null,
              triad_groups: null,
            },
          ],
        },
        calls
      )
    );
    const { result } = renderHook(() => useEnrollmentDevelopmentJourney(ENROLLMENT, COACHEE), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    const triadEvents = result.current.events.filter((e) => e.type === "triad");
    expect(triadEvents.find((e) => e.sourceId === "t1")?.title).toBe("Triad — Round 3");
    expect(triadEvents.find((e) => e.sourceId === "t2")?.title).toBe("Triad completed");
  });

  it("produces training, quiz, programme-reflection, and private-reflection events", async () => {
    from.mockImplementation(
      buildFromMock(
        {
          training_progress: [{ id: "tp1", training_week_id: "w1", completed_at: "2026-09-10T00:00:00Z", training_weeks: { title: "Delegation basics", week_number: 2 } }],
          assignment_submissions: [{ id: "as1", score_pct: 90, submitted_at: "2026-09-11T00:00:00Z", assignments: { title: "Week 2 quiz", assignment_type: "quiz", training_week_id: "w1" } }],
          reflection_submissions: [{ id: "rs1", submitted_at: "2026-10-03T00:00:00Z", programme_reflections: { title: "Mid-programme reflection", reflection_number: 1 } }],
          coachee_reflections: [{ id: "cr1", body: "Personal note", mood: "focused", created_at: "2026-09-12T00:00:00Z" }],
        },
        calls
      )
    );
    const { result } = renderHook(() => useEnrollmentDevelopmentJourney(ENROLLMENT, COACHEE), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    const subtypes = result.current.events.map((e) => e.subtype);
    expect(subtypes).toContain("training_week_completed");
    expect(subtypes).toContain("quiz_submitted");
    expect(subtypes).toContain("programme_reflection");
    expect(subtypes).toContain("private_reflection");
  });

  it("sorts every event chronologically, newest first", async () => {
    from.mockImplementation(
      buildFromMock(
        {
          coachee_goals: [{ id: "g1", title: "Early goal", status: "active", created_at: "2026-09-01T00:00:00Z" }],
          coachee_reflections: [{ id: "cr1", body: "Late note", mood: null, created_at: "2026-10-20T00:00:00Z" }],
        },
        calls
      )
    );
    const { result } = renderHook(() => useEnrollmentDevelopmentJourney(ENROLLMENT, COACHEE), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    const dates = result.current.events.map((e) => e.occurredAt);
    const sorted = [...dates].sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
    expect(dates).toEqual(sorted);
  });

  it("does not fetch without both an enrollment id and a coachee id", () => {
    from.mockImplementation(buildFromMock({}, calls));
    const { result } = renderHook(() => useEnrollmentDevelopmentJourney(undefined, undefined), { wrapper });
    expect(result.current.events).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });
});
