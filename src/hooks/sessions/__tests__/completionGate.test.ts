import { describe, it, expect } from "vitest";
import { canMarkSessionComplete } from "../completionGate";

describe("canMarkSessionComplete", () => {
  describe("regular sessions", () => {
    it("blocks completion when coachee_notes is empty", () => {
      expect(
        canMarkSessionComplete({ isPeer: false, coacheeNotes: "", peerFeedbackExisted: false })
      ).toBe(false);
    });

    it("blocks completion when coachee_notes is only whitespace", () => {
      expect(
        canMarkSessionComplete({ isPeer: false, coacheeNotes: "   \n  ", peerFeedbackExisted: false })
      ).toBe(false);
    });

    it("allows completion once coachee_notes has content", () => {
      expect(
        canMarkSessionComplete({
          isPeer: false,
          coacheeNotes: "This session helped me a lot.",
          peerFeedbackExisted: false,
        })
      ).toBe(true);
    });

    it("ignores peerFeedbackExisted for regular sessions", () => {
      expect(
        canMarkSessionComplete({ isPeer: false, coacheeNotes: "", peerFeedbackExisted: true })
      ).toBe(false);
    });
  });

  describe("peer sessions", () => {
    it("blocks completion when no competency feedback row exists", () => {
      expect(
        canMarkSessionComplete({ isPeer: true, coacheeNotes: "", peerFeedbackExisted: false })
      ).toBe(false);
    });

    it("allows completion once competency feedback exists", () => {
      expect(
        canMarkSessionComplete({ isPeer: true, coacheeNotes: "", peerFeedbackExisted: true })
      ).toBe(true);
    });

    it("ignores coacheeNotes for peer sessions", () => {
      expect(
        canMarkSessionComplete({
          isPeer: true,
          coacheeNotes: "irrelevant text",
          peerFeedbackExisted: false,
        })
      ).toBe(false);
    });
  });
});
