import { describe, expect, it } from "vitest";
import {
  canCompletePeerSession,
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

  // How late is too late is the server's question: cancel_coaching_session()
  // lets a Coach or Admin cancel at any time and a learner cancel inside 24
  // hours with a reason. This function only decides whether the STATE allows
  // cancellation at all.
  it("allows cancellation from live states only, and defers lateness to the server", () => {
    expect(canTransitionSession("pending_coach_approval", "cancel")).toBe(true);
    expect(
      canTransitionSession("confirmed", "cancel", {
        now: "2026-09-13T11:01:00.000Z",
        startTime: "2026-09-13T12:00:00.000Z",
      }),
    ).toBe(true);
    expect(canTransitionSession("completed", "cancel")).toBe(false);
    expect(canTransitionSession("cancelled", "cancel")).toBe(false);
  });

  // Peer sessions only. The Coaching branch was removed: it gated completion
  // on the learner's notes, conflating "the meeting happened" with "the
  // learner wrote it up".
  it("requires the participant's own competency feedback for peer completion", () => {
    expect(canCompletePeerSession({ peerFeedbackExists: true })).toBe(true);
    expect(canCompletePeerSession({ peerFeedbackExists: false })).toBe(false);
    expect(canCompletePeerSession({})).toBe(false);
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