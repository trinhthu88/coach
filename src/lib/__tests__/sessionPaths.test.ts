import { readFileSync } from "node:fs";
import { join } from "node:path";
import { matchPath } from "react-router-dom";
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

  // Every kind must land on a route the app actually declares, and the
  // ?type= it carries must be one SessionDetail understands -- otherwise a
  // past session in Your Sessions opens "not found" instead of its checklist.
  it("every Your Sessions kind resolves to a declared route and a type SessionDetail reads", () => {
    const app = readFileSync(join(process.cwd(), "src/App.tsx"), "utf8");
    const routes = [...app.matchAll(/path="([^"]+)"/g)].map((m) => m[1]);
    const detail = readFileSync(join(process.cwd(), "src/pages/SessionDetail.tsx"), "utf8");
    const kinds: SessionKind[] = [
      "coaching", "peer-give", "peer-receive", "coachee-peer-give", "coachee-peer-receive",
      "mentoring-mentor", "mentoring-mentee", "triad",
    ];
    for (const kind of kinds) {
      const url = new URL(sessionRowDetailPath({ id: "abc", kind }), "http://x");
      expect(routes.some((r) => matchPath(r, url.pathname)), `${kind} -> ${url.pathname}`).toBe(true);
      const type = url.searchParams.get("type");
      if (type) expect(detail, `${kind} ?type=${type}`).toContain(`sessionType === "${type}"`);
    }
    // The Triad reflection page that post-session links point to is routed too.
    expect(routes.some((r) => matchPath(r, "/triads/abc/reflect"))).toBe(true);
  });
});
