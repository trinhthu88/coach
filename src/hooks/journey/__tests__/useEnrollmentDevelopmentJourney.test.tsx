import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { from, rpc } = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from, rpc },
}));
// Whether the programme's Training checklist has Daily Prompts on.
const modules = vi.hoisted(() => ({ promptsOn: true }));
vi.mock("@/hooks/useProgrammeModules", () => ({
  useProgrammeModules: () => ({ hasModule: (m: string) => m !== "daily_prompt" || modules.promptsOn }),
}));

import { useEnrollmentDevelopmentJourney } from "../useEnrollmentDevelopmentJourney";
import type { DevelopmentJourneyEvent } from "../developmentJourneyTypes";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** Records every .eq()/.in() call per table and resolves with the table's canned rows. */
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
    query.in = (col: string, val: unknown) => {
      calls.push([table, "in", { col, val }]);
      return Promise.resolve(result);
    };
    query.not = () => query;
    query.then = (resolve: (v: typeof result) => unknown) => Promise.resolve(result).then(resolve);
    return query;
  };
}

type HistoryRow = {
  session_key?: string;
  session_type: string;
  source_table: string;
  source_id: string;
  participant_role?: string;
  title: string | null;
  start_time: string | null;
  status: string;
};

type FeedRow = {
  reflection_key: string;
  source_type: string;
  source_table: string;
  source_id: string;
  occurred_at: string;
  title?: string | null;
  body: string;
  details?: Record<string, unknown> | null;
};

function buildRpcMock(history: HistoryRow[] = [], feed: FeedRow[] = [], errors: Record<string, { message: string }> = {}) {
  return (name: string) => {
    if (errors[name]) return Promise.resolve({ data: null, error: errors[name] });
    if (name === "learner_session_history") return Promise.resolve({ data: history, error: null });
    if (name === "learner_reflection_feed") return Promise.resolve({ data: feed, error: null });
    return Promise.resolve({ data: null, error: null });
  };
}

const ENROLLMENT = "enrollment-1";
const COACHEE = "learner-1";

async function load(tables: Record<string, unknown[]> = {}, history: HistoryRow[] = [], feed: FeedRow[] = [], calls: Array<[string, string, unknown]> = []) {
  from.mockImplementation(buildFromMock(tables, calls));
  rpc.mockImplementation(buildRpcMock(history, feed));
  const { result } = renderHook(() => useEnrollmentDevelopmentJourney(ENROLLMENT, COACHEE), { wrapper });
  await waitFor(() => expect(result.current.loading).toBe(false));
  return result;
}

const find = (events: DevelopmentJourneyEvent[], predicate: (e: DevelopmentJourneyEvent) => boolean) => events.find(predicate);

describe("useEnrollmentDevelopmentJourney", () => {
  beforeEach(() => {
    from.mockReset();
    rpc.mockReset();
    modules.promptsOn = true;
  });

  it("leaves out earlier Daily Prompt answers when Daily Prompts are off in the Training checklist", async () => {
    const feed = [
      { reflection_key: "daily_prompt_response:d1", source_type: "daily_prompt_response", source_table: "daily_prompt_responses", source_id: "d1", occurred_at: "2026-09-16T00:00:00Z", body: "Tried it in stand-up." },
      { reflection_key: "training_reflection:rs1", source_type: "training_reflection", source_table: "reflection_submissions", source_id: "rs1", occurred_at: "2026-09-17T00:00:00Z", body: "I tried pausing." },
    ];
    expect((await load({}, [], feed)).current.events.map((e) => e.subtype)).toEqual(["training_reflection", "daily_prompt_response"]);
    modules.promptsOn = false;
    expect((await load({}, [], feed)).current.events.map((e) => e.subtype)).toEqual(["training_reflection"]);
  });

  it("returns an empty timeline, not fabricated events, when nothing exists", async () => {
    const result = await load();
    expect(result.current.events).toEqual([]);
    expect(result.current.partialFailure).toBe(false);
  });

  it("scopes table reads to the enrollment and reads sessions/reflections from the canonical projections", async () => {
    const calls: Array<[string, string, unknown]> = [];
    await load({}, [], [], calls);
    for (const table of ["coachee_goals", "coachee_milestones", "goal_checkins", "enrollment_actions", "training_progress", "assignment_submissions", "reflection_submissions"]) {
      expect(calls).toContainEqual([table, "enrollment_id", ENROLLMENT]);
    }
    expect(rpc).toHaveBeenCalledWith("learner_session_history", { p_enrollment_id: ENROLLMENT });
    expect(rpc).toHaveBeenCalledWith("learner_reflection_feed", { p_enrollment_id: ENROLLMENT });
    // Sessions and reflections are never re-queried table by table here.
    const tablesRead = from.mock.calls.map(([t]) => t);
    for (const table of ["sessions", "peer_sessions", "coachee_peer_sessions", "mentoring_sessions", "triad_sessions", "triad_reflections", "coachee_reflections"]) {
      expect(tablesRead).not.toContain(table);
    }
  });

  it("produces goal-created and milestone events from real rows", async () => {
    const result = await load({
      coachee_goals: [{ id: "g1", title: "Improve delegation", status: "active", created_at: "2026-09-12T00:00:00Z" }],
      coachee_milestones: [{ id: "m1", goal_id: "g1", title: "Hold weekly 1:1s", is_done: true, done_at: "2026-09-20T00:00:00Z", created_at: "2026-09-12T00:00:00Z" }],
    });
    const subtypes = result.current.events.map((e) => e.subtype);
    expect(subtypes).toEqual(expect.arrayContaining(["goal_created", "milestone_created", "milestone_completed"]));
  });

  it("produces a goal check-in event, and does not repeat its comment as a second reflection event", async () => {
    const result = await load(
      { goal_checkins: [{ id: "c1", goal_id: "g1", source_activity_type: "coaching", source_activity_id: "s1", new_rating: 56, note: "Noticed I delegate more", created_at: "2026-09-15T00:00:00Z" }] },
      [],
      [{ reflection_key: "goal_checkin:c1", source_type: "goal_checkin", source_table: "goal_checkins", source_id: "c1", occurred_at: "2026-09-15T00:00:00Z", body: "Noticed I delegate more" }]
    );
    expect(result.current.events.filter((e) => e.sourceId === "c1")).toHaveLength(1);
    expect(find(result.current.events, (e) => e.sourceId === "c1")?.subtype).toBe("goal_checkin");
  });

  it("produces action-created and action-completed events only from enrollment_actions", async () => {
    const result = await load({
      enrollment_actions: [{ id: "a1", title: "Send follow-up", status: "completed", goal_id: null, milestone_id: null, created_at: "2026-09-15T00:00:00Z", completed_at: "2026-09-19T00:00:00Z" }],
    });
    expect(result.current.events.map((e) => e.subtype)).toEqual(expect.arrayContaining(["action_created", "action_completed"]));
    expect(result.current.events.every((e) => e.sourceType === "enrollment_actions")).toBe(true);
  });

  it("produces a completed coaching session event and its reflection from the feed", async () => {
    const result = await load(
      {},
      [{ session_type: "coaching", source_table: "sessions", source_id: "s1", title: "Delegation coaching", start_time: "2026-09-15T10:00:00Z", status: "completed" }],
      [{ reflection_key: "coaching_session_reflection:s1", source_type: "coaching_session_reflection", source_table: "sessions", source_id: "s1", occurred_at: "2026-09-15T10:00:00Z", body: "Felt confident delegating this week." }]
    );
    expect(find(result.current.events, (e) => e.type === "coaching")?.subtype).toBe("session_completed");
    const reflection = find(result.current.events, (e) => e.type === "reflection");
    expect(reflection?.subtype).toBe("coaching_session_reflection");
    expect(reflection?.summary).toBe("Felt confident delegating this week.");
  });

  it("does not create a session event for a scheduled (not completed) session", async () => {
    const result = await load({}, [{ session_type: "coaching", source_table: "sessions", source_id: "s2", title: "Upcoming", start_time: "2026-10-01T10:00:00Z", status: "confirmed" }]);
    expect(result.current.events).toEqual([]);
  });

  it("includes coachee peer practice (coachee_peer_sessions), received and given", async () => {
    const result = await load({}, [
      { session_type: "peer_coaching", source_table: "coachee_peer_sessions", source_id: "cp1", participant_role: "receiver", title: "Practice", start_time: "2026-09-25T10:00:00Z", status: "completed" },
      { session_type: "peer_coaching", source_table: "coachee_peer_sessions", source_id: "cp2", participant_role: "provider", title: "Practice given", start_time: "2026-09-26T10:00:00Z", status: "completed" },
    ]);
    const peer = result.current.events.filter((e) => e.type === "peer_coaching");
    expect(peer.map((e) => e.sourceType)).toEqual(["coachee_peer_sessions", "coachee_peer_sessions"]);
    expect(find(peer, (e) => e.sourceId === "cp2")?.title).toBe("Peer practice given");
  });

  it("produces peer competency feedback for the enrollment's coach-to-coach peer sessions", async () => {
    const result = await load(
      { peer_session_competency_feedback: [{ id: "pf1", peer_session_id: "p1", feedback_note: "Great listening.", created_at: "2026-09-25T11:00:00Z" }] },
      [{ session_type: "peer_coaching", source_table: "peer_sessions", source_id: "p1", title: "Peer session", start_time: "2026-09-25T10:00:00Z", status: "completed" }]
    );
    expect(result.current.events.some((e) => e.type === "peer_coaching")).toBe(true);
    expect(result.current.events.some((e) => e.subtype === "peer_competency_feedback")).toBe(true);
  });

  it("produces mentoring session, mentee reflection and mentor feedback events", async () => {
    const result = await load(
      { mentoring_feedback: [{ id: "mf1", mentoring_session_id: "ms1", overall_notes: "Strong presence.", submitted_at: "2026-10-08T11:00:00Z" }] },
      [{ session_type: "mentoring", source_table: "mentoring_sessions", source_id: "ms1", title: "Mentoring", start_time: "2026-10-08T10:00:00Z", status: "completed" }],
      [{ reflection_key: "mentoring_session_reflection:ms1", source_type: "mentoring_session_reflection", source_table: "mentoring_sessions", source_id: "ms1", occurred_at: "2026-10-08T10:00:00Z", body: "Learned a lot." }]
    );
    expect(result.current.events.map((e) => e.subtype)).toEqual(expect.arrayContaining(["session_completed", "mentoring_session_reflection", "mentoring_feedback"]));
  });

  it("produces a triad event only for a completed session, dated on the session, never with a round", async () => {
    const result = await load({}, [
      { session_type: "triad", source_table: "triad_sessions", source_id: "t1", title: null, start_time: "2026-10-14T10:00:00Z", status: "completed" },
      { session_type: "triad", source_table: "triad_sessions", source_id: "t2", title: null, start_time: "2026-11-01T10:00:00Z", status: "confirmed" },
      { session_type: "triad", source_table: "triad_sessions", source_id: "t3", title: null, start_time: "2026-10-20T10:00:00Z", status: "completed" },
    ]);
    const triads = result.current.events.filter((e) => e.type === "triad");
    expect(triads.map((e) => e.sourceId).sort()).toEqual(["t1", "t3"]);
    expect(find(triads, (e) => e.sourceId === "t1")?.title).toBe("Triad completed");
    expect(find(triads, (e) => e.sourceId === "t1")?.occurredAt).toBe("2026-10-14T10:00:00Z");
    expect(triads.some((e) => /Round/.test(e.title))).toBe(false);
  });

  it("produces a Triad Self-Reflection as a REFLECTION, never FEEDBACK", async () => {
    const result = await load({}, [], [
      { reflection_key: "triad_reflection:tr1", source_type: "triad_reflection", source_table: "triad_reflections", source_id: "tr1", occurred_at: "2026-10-14T11:00:00Z", body: "Stayed curious longer than usual.", details: { session_start_time: "2026-10-14T10:00:00Z", triad_group_id: "g1" } },
    ]);
    const event = find(result.current.events, (e) => e.sourceId === "tr1");
    expect(event?.type).toBe("reflection");
    expect(event?.title).toBe("Triad Self-Reflection");
    expect(event?.summary).toBe("Stayed curious longer than usual.");
    expect(result.current.events.some((e) => e.sourceId === "tr1" && e.type === "feedback")).toBe(false);
  });

  it("produces training, quiz and programme-reflection activity plus feed reflections", async () => {
    const result = await load(
      {
        training_progress: [{ id: "tp1", training_week_id: "w1", completed_at: "2026-09-10T00:00:00Z", training_weeks: { title: "Delegation basics", week_number: 2 } }],
        assignment_submissions: [{ id: "as1", score_pct: 90, submitted_at: "2026-09-11T00:00:00Z", assignments: { title: "Week 2 quiz", assignment_type: "quiz", training_week_id: "w1" } }],
        reflection_submissions: [{ id: "rs1", submitted_at: "2026-10-03T00:00:00Z", programme_reflections: { title: "Mid-programme reflection", reflection_number: 1 } }],
      },
      [],
      [
        { reflection_key: "training_reflection:rs1", source_type: "training_reflection", source_table: "reflection_submissions", source_id: "rs1", occurred_at: "2026-10-03T00:00:00Z", body: "I tried pausing." },
        { reflection_key: "journey_reflection:cr1", source_type: "journey_reflection", source_table: "coachee_reflections", source_id: "cr1", occurred_at: "2026-09-12T00:00:00Z", body: "Personal note" },
      ]
    );
    const subtypes = result.current.events.map((e) => e.subtype);
    expect(subtypes).toEqual(
      expect.arrayContaining(["training_week_completed", "quiz_submitted", "programme_reflection_submitted", "training_reflection", "journey_reflection"])
    );
    expect(find(result.current.events, (e) => e.subtype === "programme_reflection_submitted")?.type).toBe("training");
  });

  it("sorts every event chronologically, newest first", async () => {
    const result = await load(
      { coachee_goals: [{ id: "g1", title: "Early goal", status: "active", created_at: "2026-09-01T00:00:00Z" }] },
      [],
      [{ reflection_key: "journey_reflection:cr1", source_type: "journey_reflection", source_table: "coachee_reflections", source_id: "cr1", occurred_at: "2026-10-20T00:00:00Z", body: "Late note" }]
    );
    const dates = result.current.events.map((e) => e.occurredAt);
    expect(dates).toEqual([...dates].sort((a, b) => new Date(b).getTime() - new Date(a).getTime()));
  });

  it("flags a partial failure when a canonical projection fails, instead of presenting an incomplete history as complete", async () => {
    from.mockImplementation(buildFromMock({}, []));
    rpc.mockImplementation(buildRpcMock([], [], { learner_reflection_feed: { message: "boom" } }));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { result } = renderHook(() => useEnrollmentDevelopmentJourney(ENROLLMENT, COACHEE), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.partialFailure).toBe(true);
    errorSpy.mockRestore();
  });

  it("does not fetch without both an enrollment id and a coachee id", () => {
    from.mockImplementation(buildFromMock({}, []));
    const { result } = renderHook(() => useEnrollmentDevelopmentJourney(undefined, undefined), { wrapper });
    expect(result.current.events).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});
