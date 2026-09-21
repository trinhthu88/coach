import { describe, expect, it } from "vitest";
import { derivePendingDeliverables } from "../pendingReflections";
import type { SessionDeliverable } from "@/lib/postSessionDeliverables";

const row = (over: Partial<SessionDeliverable>): SessionDeliverable => ({
  module: "coaching",
  sourceTable: "sessions",
  sessionId: "s1",
  participantRole: "coachee",
  title: null,
  startTime: "2026-06-01T09:00:00Z",
  counterpartNames: [],
  requirementUnitNumber: null,
  hasReflection: true,
  hasGoalCheckin: true,
  goalCheckinRequired: true,
  hasAction: true,
  hasSatisfaction: true,
  satisfactionRating: 4,
  deliverablesComplete: true,
  ...over,
});

describe("derivePendingDeliverables", () => {
  it("lists only sessions the canonical rows mark incomplete, newest first, with their missing items", () => {
    const pending = derivePendingDeliverables([
      row({ sessionId: "done" }),
      row({ sessionId: "c1", startTime: "2026-05-01T09:00:00Z", hasAction: false, hasSatisfaction: false, deliverablesComplete: false }),
      row({ module: "mentoring", sourceTable: "mentoring_sessions", sessionId: "m1", startTime: "2026-06-02T09:00:00Z", hasReflection: false, deliverablesComplete: false }),
    ]);
    expect(pending.map((p) => p.deliverable.sessionId)).toEqual(["m1", "c1"]);
    expect(pending[0].outstanding).toEqual(["reflection"]);
    expect(pending[0].path).toBe("/mentoring/sessions/m1");
    expect(pending[1].outstanding).toEqual(["action", "satisfaction"]);
    expect(pending[1].path).toBe("/sessions/c1");
  });

  it("never lists a goal check-in the learner cannot do (no active goal)", () => {
    const [p] = derivePendingDeliverables([
      row({ hasGoalCheckin: false, goalCheckinRequired: false, hasReflection: false, deliverablesComplete: false }),
    ]);
    expect(p.outstanding).toEqual(["reflection"]);
  });

  it("covers both Peer roles, each linked to the peer-practice detail", () => {
    const pending = derivePendingDeliverables([
      row({ module: "peer_coaching", sourceTable: "coachee_peer_sessions", sessionId: "p1", participantRole: "receiver", deliverablesComplete: false, hasAction: false }),
      row({ module: "peer_coaching", sourceTable: "coachee_peer_sessions", sessionId: "p2", participantRole: "provider", deliverablesComplete: false, hasReflection: false }),
    ]);
    expect(pending.map((p) => p.path)).toEqual(["/sessions/p1?type=coachee_peer", "/sessions/p2?type=coachee_peer"]);
  });

  it("sends a Triad learner to the reflection page until the reflection is written", () => {
    const [unwritten, written] = derivePendingDeliverables([
      row({ module: "triads", sourceTable: "triad_sessions", sessionId: "t1", startTime: "2026-06-03T09:00:00Z", hasReflection: false, deliverablesComplete: false }),
      row({ module: "triads", sourceTable: "triad_sessions", sessionId: "t2", hasAction: false, deliverablesComplete: false }),
    ]);
    expect(unwritten.path).toBe("/triads/t1/reflect");
    expect(written.path).toBe("/triads/t2");
  });
});
