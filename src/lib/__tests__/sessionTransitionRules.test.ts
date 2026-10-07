import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  decideTransition,
  httpStatusForRpcError,
  transitionRpc,
} from "../../../supabase/functions/_shared/sessionTransitionRules";

const fnSource = (name: string) =>
  readFileSync(path.resolve(__dirname, `../../../supabase/functions/${name}/index.ts`), "utf8");

describe("decideTransition", () => {
  it.each(["cancelled", "completed", "rescheduled"])("refuses to confirm a %s session", (status) => {
    expect(decideTransition("confirm", status)).toMatchObject({ kind: "refuse", httpStatus: 409 });
  });
  it.each(["cancelled", "completed", "rescheduled"])("refuses to cancel a %s session", (status) => {
    expect(decideTransition("cancel", status)).toMatchObject({ kind: "refuse", httpStatus: 409 });
  });
  it("confirms a pending session", () => {
    expect(decideTransition("confirm", "pending_coach_approval")).toEqual({ kind: "proceed" });
  });
  it("treats a second confirm as already done", () => {
    expect(decideTransition("confirm", "confirmed")).toEqual({ kind: "already_confirmed" });
  });
  it.each(["pending_coach_approval", "confirmed"])("cancels a live (%s) session", (status) => {
    expect(decideTransition("cancel", status)).toEqual({ kind: "proceed" });
  });
});

describe("transitionRpc", () => {
  it("confirms through the canonical confirm RPCs, with the meeting link", () => {
    expect(transitionRpc("confirm", false, "s1", { meetingUrl: "https://z" })).toEqual({
      fn: "confirm_coaching_session", args: { p_session_id: "s1", p_meeting_url: "https://z" },
    });
    expect(transitionRpc("confirm", true, "p1", { meetingUrl: "https://z" })).toEqual({
      fn: "confirm_peer_session", args: { p_session_id: "p1", p_meeting_url: "https://z" },
    });
  });
  it("cancels through the canonical cancel RPCs, with the reason", () => {
    expect(transitionRpc("cancel", false, "s1", { reason: "Ill" })).toEqual({
      fn: "cancel_coaching_session", args: { p_session_id: "s1", p_reason: "Ill" },
    });
    expect(transitionRpc("cancel", true, "p1", { reason: "" })).toEqual({
      fn: "transition_peer_session_status",
      args: { p_session_kind: "peer", p_session_id: "p1", p_status: "cancelled", p_reason: null },
    });
  });
});

describe("httpStatusForRpcError", () => {
  it("maps lifecycle errors to HTTP statuses", () => {
    expect(httpStatusForRpcError("42501")).toBe(403);
    expect(httpStatusForRpcError("23503")).toBe(404);
    expect(httpStatusForRpcError("23514")).toBe(409);
    expect(httpStatusForRpcError("23505")).toBe(409);
    expect(httpStatusForRpcError(undefined)).toBe(400);
  });
});

// The edge functions themselves: status is changed only by an RPC run with the
// caller's JWT, never by a service-role write.
describe.each(["confirm-session", "cancel-session"])("%s", (name) => {
  const src = fnSource(name);
  it("never writes a session table", () => {
    expect(src).not.toMatch(/\.from\([^)]*\)\s*\.(update|insert|upsert|delete)\(/);
    expect(src).not.toMatch(/\.(update|insert|upsert)\(\s*\{[^}]*status/);
  });
  it("calls the lifecycle RPC with a client built on the caller's Authorization header", () => {
    expect(src).toMatch(/global:\s*\{\s*headers:\s*\{\s*Authorization:\s*authHeader\s*\}\s*\}/);
    expect(src).toMatch(/asCaller\.rpc\(\s*rpc\.fn,\s*rpc\.args\s*\)/);
    expect(src).not.toMatch(/admin\.rpc\(/);
  });
  it("refuses a final session before any side effect", () => {
    const decision = src.indexOf("decideTransition(");
    expect(decision).toBeGreaterThan(-1);
    expect(decision).toBeLessThan(src.indexOf("asCaller.rpc("));
    const zoom = src.indexOf("await getZoomAccessToken()");
    if (zoom > -1) expect(decision).toBeLessThan(zoom);
  });
});
