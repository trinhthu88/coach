import { describe, expect, it } from "vitest";
import { sessionDetailPathFor, sessionRowDetailPath } from "../sessionPaths";
import type { SessionKind } from "@/hooks/sessions/useSessionsData";

describe("session detail routing", () => {
  it("routes every Your Sessions row kind to the detail page that reads its own table", () => {
    const expected: Record<SessionKind, string> = {
      coaching: "/sessions/x",
      "peer-give": "/sessions/x?type=peer",
      "peer-receive": "/sessions/x?type=peer",
      "coachee-peer-give": "/sessions/x?type=coachee_peer",
      "coachee-peer-receive": "/sessions/x?type=coachee_peer",
      "mentoring-mentor": "/mentoring/sessions/x",
      "mentoring-mentee": "/mentoring/sessions/x",
      triad: "/triads/x",
    };
    for (const [kind, path] of Object.entries(expected)) {
      expect(sessionRowDetailPath({ id: "x", kind: kind as SessionKind })).toBe(path);
    }
  });

  it("never sends coachee peer practice to the coach-to-coach peer table", () => {
    expect(sessionDetailPathFor("coachee_peer_sessions", "p1")).toBe("/sessions/p1?type=coachee_peer");
    expect(sessionDetailPathFor("peer_sessions", "p1")).toBe("/sessions/p1?type=peer");
  });

  it("returns null for an unknown source rather than guessing a route", () => {
    expect(sessionDetailPathFor("unknown_table", "x")).toBeNull();
  });
});
