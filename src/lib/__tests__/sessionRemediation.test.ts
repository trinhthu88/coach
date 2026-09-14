import { describe, expect, it } from "vitest";
import {
  canCompleteSession,
  canTransitionSession,
  getAllowedSessionPatch,
} from "../sessionLifecycle";

describe("session lifecycle remediation", () => {
  it("allows only pending sessions to be confirmed", () => {
    expect(canTransitionSession("pending_coach_approval", "confirm")).toBe(true);
    expect(canTransitionSession("confirmed", "confirm")).toBe(false);
    expect(canTransitionSession("completed", "confirm")).toBe(false);
    expect(canTransitionSession("cancelled", "confirm")).toBe(false);
  });

  it("allows cancellation only from live states and never after the cutoff", () => {
    expect(
      canTransitionSession("pending_coach_approval", "cancel", {
        now: "2026-09-13T09:00:00.000Z",
        startTime: "2026-09-15T12:00:00.000Z",
      }),
    ).toBe(true);
    expect(
      canTransitionSession("confirmed", "cancel", {
        now: "2026-09-13T11:01:00.000Z",
        startTime: "2026-09-13T12:00:00.000Z",
      }),
    ).toBe(false);
    expect(canTransitionSession("completed", "cancel")).toBe(false);
    expect(canTransitionSession("cancelled", "cancel")).toBe(false);
  });

  it("requires the correct completion evidence for every peer relationship", () => {
    expect(canCompleteSession({ kind: "coaching", coacheeNotes: "reflection" })).toBe(true);
    expect(canCompleteSession({ kind: "coaching", coacheeNotes: "  " })).toBe(false);
    expect(canCompleteSession({ kind: "peer", peerFeedbackExists: true })).toBe(true);
    expect(canCompleteSession({ kind: "coachee_peer", peerFeedbackExists: true })).toBe(true);
    expect(canCompleteSession({ kind: "coachee_peer", peerFeedbackExists: false })).toBe(false);
  });

  it("keeps participant patches away from protected session fields", () => {
    expect(
      getAllowedSessionPatch("coach", {
        status: "completed",
        enrollment_id: "other-enrollment",
        coach_notes: "new notes",
        meeting_url: "https://example.test",
      }),
    ).toEqual({ coach_notes: "new notes", meeting_url: "https://example.test" });
  });
});