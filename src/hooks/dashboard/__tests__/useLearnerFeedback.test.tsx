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
function fakeSupabaseFrom(
  rowsByTable: Record<string, Record<string, unknown>[]>,
  options: { failTables?: Record<string, { message: string; code?: string }>; selects?: Record<string, string[]> } = {}
) {
  return (table: string) => {
    let rows = rowsByTable[table] ?? [];
    const error = options.failTables?.[table] ?? null;
    const builder = {
      select: (columns: string) => {
        if (options.selects) (options.selects[table] ??= []).push(columns);
        return builder;
      },
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
      not: (col: string, op: string, val: unknown) => {
        if (op === "is" && val === null) rows = rows.filter((row) => row[col] != null);
        return builder;
      },
      order: () => builder,
      limit: () => builder,
      in: (col: string, vals: unknown[]) => {
        rows = rows.filter((row) => vals.includes(row[col]));
        return builder;
      },
      then: (resolve: (value: { data: unknown; error: unknown }) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(error ? { data: null, error } : { data: rows, error: null }).then(resolve, reject),
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

describe("useLearnerFeedback — peer competency feedback without a PostgREST embed", () => {
  const peerFeedbackRow = (id: string, sessionId: string) => ({
    id,
    peer_session_id: sessionId,
    peer_coach_id: "learner-1",
    peer_coachee_id: "peer-1",
    feedback_note: "Clear contracting",
    created_at: "2026-06-02T00:00:00Z",
    ethical_practice: 80,
    coaching_mindset: null,
    maintains_agreements: null,
    trust_safety: null,
    maintains_presence: null,
    listens_actively: 70,
    evokes_awareness: null,
    facilitates_growth: null,
  });

  it("resolves the enrollment's peer sessions first and never embeds peer_sessions (no FK exists)", async () => {
    const selects: Record<string, string[]> = {};
    mockFrom.mockImplementation(
      fakeSupabaseFrom(
        {
          mentoring_feedback: [],
          peer_sessions: [
            { id: "ps-a", enrollment_id: "enrollment-A", peer_coach_id: "learner-1" },
            { id: "ps-b", enrollment_id: "enrollment-B", peer_coach_id: "learner-1" },
          ],
          peer_session_competency_feedback: [peerFeedbackRow("pf-a", "ps-a"), peerFeedbackRow("pf-b", "ps-b")],
          profiles: [{ id: "peer-1", full_name: "Peer One" }],
        },
        { selects }
      )
    );

    const { result } = renderHook(() => useLearnerFeedback("learner-1", "enrollment-A"), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeNull();
    expect(result.current.feedback.map((f) => f.id)).toEqual(["pf-a"]);
    expect(result.current.feedback[0]).toMatchObject({ kind: "peer_competency", fromName: "Peer One", note: "Clear contracting" });
    expect(selects.peer_session_competency_feedback.join(" ")).not.toMatch(/peer_sessions/);
  });

  it("surfaces a real fetch error instead of an empty feedback list", async () => {
    mockFrom.mockImplementation(
      fakeSupabaseFrom({ peer_sessions: [] }, { failTables: { mentoring_feedback: { message: "permission denied", code: "42501" } } })
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { result } = renderHook(() => useLearnerFeedback("learner-1", "enrollment-A"), { wrapper });
    await waitFor(() => expect(result.current.error).toBe("permission denied"));
    expect(result.current.feedback).toEqual([]);
    errorSpy.mockRestore();
  });
});

describe("useLearnerFeedback — shared session notes", () => {
  it("includes coach, mentor and peer-practice shared notes for this enrollment, never private notes", async () => {
    const selects: Record<string, string[]> = {};
    mockFrom.mockImplementation(
      fakeSupabaseFrom(
        {
          mentoring_feedback: [],
          peer_sessions: [],
          sessions: [
            { id: "s-1", topic: "Delegation", start_time: "2026-03-01T10:00:00Z", coach_id: "coach-1", coach_notes: "Try the 3-question check-in.", enrollment_id: "enrollment-A", coachee_id: "learner-1" },
            { id: "s-2", topic: "Other programme", start_time: "2026-03-02T10:00:00Z", coach_id: "coach-1", coach_notes: "Other enrollment", enrollment_id: "enrollment-B", coachee_id: "learner-1" },
            { id: "s-3", topic: "Blank", start_time: "2026-03-03T10:00:00Z", coach_id: "coach-1", coach_notes: "   ", enrollment_id: "enrollment-A", coachee_id: "learner-1" },
          ],
          mentoring_sessions: [
            { id: "m-1", topic: "Career", start_time: "2026-03-04T10:00:00Z", mentor_id: "mentor-1", mentor_notes: "Map your stakeholders.", enrollment_id: "enrollment-A", mentee_id: "learner-1" },
          ],
          coachee_peer_sessions: [
            { id: "p-1", topic: "Practice", start_time: "2026-03-05T10:00:00Z", peer_provider_id: "peer-1", provider_notes: "Great open questions.", enrollment_id: "enrollment-A", peer_receiver_id: "learner-1" },
          ],
          profiles: [
            { id: "coach-1", full_name: "Casey Coach" },
            { id: "mentor-1", full_name: "Morgan Mentor" },
            { id: "peer-1", full_name: "Pat Peer" },
          ],
        },
        { selects }
      )
    );

    const { result } = renderHook(() => useLearnerFeedback("learner-1", "enrollment-A"), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeNull();
    const notes = result.current.feedback.filter((f) => f.kind === "session_note");
    expect(notes.map((n) => n.kind === "session_note" && `${n.source}:${n.fromName}:${n.note}`)).toEqual([
      "peer_practice:Pat Peer:Great open questions.",
      "mentoring:Morgan Mentor:Map your stakeholders.",
      "coaching:Casey Coach:Try the 3-question check-in.",
    ]);
    const allSelects = Object.values(selects).flat().join(" ");
    expect(allSelects).not.toMatch(/private_notes/);
  });
});
