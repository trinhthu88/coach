import { describe, it, expect } from "vitest";
import { canMarkSessionComplete } from "../completionGate";

describe("canMarkSessionComplete", () => {
  describe("Coaching sessions", () => {
    const held = { isPeer: false, peerFeedbackExisted: false, isConfirmed: true, hasStarted: true, isCoachOrAdmin: true };

    it("allows the Coach to mark a confirmed session held once it has started", () => {
      expect(canMarkSessionComplete(held)).toBe(true);
    });

    it("blocks completion before the session has started", () => {
      expect(canMarkSessionComplete({ ...held, hasStarted: false })).toBe(false);
    });

    it("blocks completion while the session is still pending confirmation", () => {
      expect(canMarkSessionComplete({ ...held, isConfirmed: false })).toBe(false);
    });

    it("blocks the learner from marking the session held", () => {
      expect(canMarkSessionComplete({ ...held, isCoachOrAdmin: false })).toBe(false);
    });

    it("no longer depends on the learner's notes: the session is held or it is not", () => {
      // Previously coachee_notes gated this, conflating "the conversation
      // happened" with "the learner did their post-session work". The latter is
      // now coaching_session_evidence(), which gates the programme UNIT.
      expect(canMarkSessionComplete(held)).toBe(true);
    });

    it("ignores peerFeedbackExisted for Coaching sessions", () => {
      expect(
        canMarkSessionComplete({ ...held, isConfirmed: false, peerFeedbackExisted: true }),
      ).toBe(false);
    });
  });

  describe("peer sessions", () => {
    it("blocks completion when no competency feedback row exists", () => {
      expect(canMarkSessionComplete({ isPeer: true, peerFeedbackExisted: false })).toBe(false);
    });

    it("allows completion once competency feedback exists", () => {
      expect(canMarkSessionComplete({ isPeer: true, peerFeedbackExisted: true })).toBe(true);
    });

    it("ignores the Coaching preconditions for peer sessions", () => {
      expect(
        canMarkSessionComplete({
          isPeer: true,
          peerFeedbackExisted: true,
          isConfirmed: false,
          hasStarted: false,
          isCoachOrAdmin: false,
        }),
      ).toBe(true);
    });
  });
});
