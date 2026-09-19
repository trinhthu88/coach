import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, from } = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc, from },
}));

import { useEnrollmentSessions } from "../useEnrollmentSessions";
import { sessionDetailPath } from "@/lib/sessionPaths";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const ENROLLMENT = "enrollment-1";
const USER = "learner-1";

const row = (over: Record<string, unknown>) => ({
  session_key: `${over.session_type}:${over.source_table}:${over.source_id}`,
  module: "coaching",
  participant_role: "coachee",
  title: "Session",
  start_time: "2026-02-01T10:00:00Z",
  status: "completed",
  counterpart_names: [],
  attributed_to_enrollment: true,
  is_programme_evidence: true,
  ...over,
});

/** The reported Emerging Leaders case: triads 1 completed + 1 confirmed, peer 2 received + 2 given. */
const REPORTED_CASE = [
  row({ session_type: "coaching", source_table: "sessions", source_id: "s1", counterpart_names: ["Casey Coach"] }),
  row({ session_type: "peer_coaching", source_table: "coachee_peer_sessions", source_id: "p1", module: "peer_coaching", participant_role: "receiver", start_time: "2026-02-02T08:00:00Z" }),
  row({ session_type: "peer_coaching", source_table: "coachee_peer_sessions", source_id: "p2", module: "peer_coaching", participant_role: "receiver", start_time: "2026-03-02T08:00:00Z" }),
  row({ session_type: "peer_coaching", source_table: "coachee_peer_sessions", source_id: "g1", module: "peer_coaching", participant_role: "provider", start_time: "2026-02-03T08:00:00Z", attributed_to_enrollment: false, is_programme_evidence: false }),
  row({ session_type: "peer_coaching", source_table: "coachee_peer_sessions", source_id: "g2", module: "peer_coaching", participant_role: "provider", status: "confirmed", start_time: "2026-04-05T08:00:00Z", attributed_to_enrollment: false, is_programme_evidence: false }),
  row({ session_type: "mentoring", source_table: "mentoring_sessions", source_id: "m1", module: "mentoring", participant_role: "mentee", counterpart_names: ["Morgan Mentor"] }),
  row({ session_type: "triad", source_table: "triad_sessions", source_id: "t1", module: "triads", participant_role: "coach", title: null, start_time: "2026-02-16T03:00:00Z", counterpart_names: ["A", "B"] }),
  row({ session_type: "triad", source_table: "triad_sessions", source_id: "t2", module: "triads", participant_role: "coach", title: null, status: "confirmed", start_time: "2026-04-20T03:00:00Z", is_programme_evidence: false }),
];

describe("useEnrollmentSessions (learner_session_history)", () => {
  beforeEach(() => {
    rpc.mockReset();
    from.mockReset();
  });

  it("reads the canonical history projection for the enrollment, never the session tables directly", async () => {
    rpc.mockResolvedValue({ data: REPORTED_CASE, error: null });
    const { result } = renderHook(() => useEnrollmentSessions(ENROLLMENT, USER), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(rpc).toHaveBeenCalledWith("learner_session_history", { p_enrollment_id: ENROLLMENT });
    expect(from).not.toHaveBeenCalled();
  });

  it("keeps both triad sessions with their real statuses (1 completed evidence + 1 confirmed)", async () => {
    rpc.mockResolvedValue({ data: REPORTED_CASE, error: null });
    const { result } = renderHook(() => useEnrollmentSessions(ENROLLMENT, USER), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    const triads = result.current.sessions.filter((s) => s.type === "triad");
    expect(triads.map((s) => [s.status, s.isProgrammeEvidence])).toEqual([
      ["completed", true],
      ["confirmed", false],
    ]);
    // A Triad session belongs to its group only: no round / week label.
    expect(triads[0].title).toBe("");
    expect(triads[0]).not.toHaveProperty("roundLabel");
    expect(triads[0].counterpartNames).toEqual(["A", "B"]);
  });

  it("includes coachee peer practice (received and given) — more records than the 2/2 requirement", async () => {
    rpc.mockResolvedValue({ data: REPORTED_CASE, error: null });
    const { result } = renderHook(() => useEnrollmentSessions(ENROLLMENT, USER), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    const peer = result.current.sessions.filter((s) => s.type === "peer_coaching");
    expect(peer).toHaveLength(4);
    expect(peer.every((s) => s.sourceType === "coachee_peer_sessions")).toBe(true);
    expect(peer.filter((s) => s.isProgrammeEvidence)).toHaveLength(2);
    expect(peer.filter((s) => s.participantRole === "provider")).toHaveLength(2);
  });

  it("resolves a valid detail route for every coaching / peer / mentoring / triad row", async () => {
    rpc.mockResolvedValue({ data: REPORTED_CASE, error: null });
    const { result } = renderHook(() => useEnrollmentSessions(ENROLLMENT, USER), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    const paths = Object.fromEntries(result.current.sessions.map((s) => [s.sourceId, sessionDetailPath(s)]));
    expect(paths).toEqual({
      s1: "/sessions/s1",
      p1: "/sessions/p1?type=coachee_peer",
      p2: "/sessions/p2?type=coachee_peer",
      g1: "/sessions/g1?type=coachee_peer",
      g2: "/sessions/g2?type=coachee_peer",
      m1: "/mentoring/sessions/m1",
      t1: "/triads/t1",
      t2: "/triads/t2",
    });
  });

  it("surfaces an RPC failure as an error, not an empty history", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "permission denied" } });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { result } = renderHook(() => useEnrollmentSessions(ENROLLMENT, USER), { wrapper });
    await waitFor(() => expect(result.current.error).toBe("permission denied"));
    expect(result.current.sessions).toEqual([]);
    errorSpy.mockRestore();
  });

  it("does not fetch without an enrollment and user", () => {
    const { result } = renderHook(() => useEnrollmentSessions(undefined, USER), { wrapper });
    expect(result.current.loading).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});
