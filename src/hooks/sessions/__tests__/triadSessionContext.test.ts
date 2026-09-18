import { describe, expect, it } from "vitest";
import { getTriadRole, normalizeTriadSession, type TriadSessionSourceRow } from "../useSessionsData";

const session = (overrides: Partial<TriadSessionSourceRow> = {}) =>
  ({
    id: "triad-session-1",
    coach_enrollment_id: "enrollment-coach",
    coachee_enrollment_id: "enrollment-coachee",
    observer_enrollment_id: "enrollment-observer",
    triad_group_id: "group-1",
    status: "proposed",
    start_time: null,
    proposed_start_time: "2026-09-20T10:00:00Z",
    proposed_end_time: "2026-09-20T11:00:00Z",
    meeting_url: null,
    triad_groups: {
      id: "group-1",
      member_1_id: "user-1",
      member_2_id: "user-2",
      member_3_id: "user-3",
      round_number: null,
      triad_rounds: {
        round_number: 2,
        title: "Configured round title",
        training_weeks: { week_number: 4 },
      },
    },
    ...overrides,
  }) as unknown as TriadSessionSourceRow;

describe("unified Triad session context", () => {
  it("resolves the learner role from enrollment membership and preserves configured context", () => {
    const normalized = normalizeTriadSession(session(), new Set(["enrollment-coachee"]));

    expect(getTriadRole(session(), new Set(["enrollment-coachee"]))).toBe("coachee");
    expect(normalized.kind).toBe("triad");
    expect(normalized.enrollment_id).toBe("enrollment-coachee");
    expect(normalized.start_time).toBe("2026-09-20T10:00:00Z");
    expect(normalized.triad.roundNumber).toBe(2);
    expect(normalized.triad.roundTitle).toBe("Configured round title");
    expect(normalized.triad.weekNumber).toBe(4);
  });

  it("does not invent round or week values when canonical relationships are absent", () => {
    const normalized = normalizeTriadSession(
      session({
        start_time: "2026-09-20T10:00:00Z",
        proposed_start_time: null,
        triad_groups: null,
      }),
      new Set(["unrelated-enrollment"])
    );

    expect(normalized.triad.role).toBeNull();
    expect(normalized.triad.roundNumber).toBeNull();
    expect(normalized.triad.roundTitle).toBeNull();
    expect(normalized.triad.weekNumber).toBeNull();
    expect(normalized.start_time).toBe("2026-09-20T10:00:00Z");
  });
});