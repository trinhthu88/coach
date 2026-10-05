import { describe, it, expect } from "vitest";
import {
  adminDetailsEditable,
  adminStatusOptions,
  planAdminSessionSave,
  type AdminSessionSnapshot,
} from "../adminSessionEdit";

const base: AdminSessionSnapshot = {
  id: "s1",
  kind: "coaching",
  status: "confirmed",
  topic: "Leadership",
  start_time: "2026-11-01T09:00:00.000Z",
  duration_minutes: 60,
  meeting_url: "https://meet/old",
};

describe("adminStatusOptions", () => {
  it("offers only the moves the lifecycle allows", () => {
    expect(adminStatusOptions("pending_coach_approval")).toEqual(["pending_coach_approval", "confirmed", "cancelled"]);
    expect(adminStatusOptions("confirmed")).toEqual(["confirmed", "completed", "cancelled"]);
    expect(adminStatusOptions("cancelled")).toEqual(["cancelled", "pending_coach_approval"]);
    expect(adminStatusOptions("completed")).toEqual(["completed", "confirmed"]);
    expect(adminStatusOptions("rescheduled")).toEqual(["rescheduled"]);
  });
});

describe("planAdminSessionSave", () => {
  it("reschedules a live session through admin_reschedule_session, with the reason", () => {
    const plan = planAdminSessionSave(base,
      { ...base, start_time: "2026-11-02T09:00:00.000Z", duration_minutes: 45, topic: "New", meeting_url: "https://meet/new" },
      { reason: " Coach asked " });
    expect(plan).toEqual({ ok: true, steps: [{ type: "rpc", fn: "admin_reschedule_session", args: {
      p_kind: "coaching", p_session_id: "s1", p_start_time: "2026-11-02T09:00:00.000Z", p_duration_minutes: 45,
      p_reason: "Coach asked", p_topic: "New", p_meeting_url: "https://meet/new" } }] });
  });

  it("requires a reason to reschedule", () => {
    expect(planAdminSessionSave(base, { ...base, topic: "New" }, { reason: "  " }))
      .toEqual({ ok: false, error: "reasonRequired" });
  });

  it("does nothing when nothing changed", () => {
    expect(planAdminSessionSave(base, { ...base }, { reason: "" })).toEqual({ ok: true, steps: [] });
  });

  it("reopens a cancelled session at a new time", () => {
    const cancelled = { ...base, status: "cancelled" };
    const plan = planAdminSessionSave(cancelled,
      { ...cancelled, status: "pending_coach_approval", start_time: "2026-11-05T09:00:00.000Z" },
      { reason: "Cancelled by mistake" });
    expect(plan).toEqual({ ok: true, steps: [{ type: "rpc", fn: "admin_reopen_session", args: {
      p_kind: "coaching", p_session_id: "s1", p_reason: "Cancelled by mistake",
      p_start_time: "2026-11-05T09:00:00.000Z", p_duration_minutes: 60 } }] });
  });

  it("reopens a completed session at its own time, and locks its details", () => {
    const completed = { ...base, status: "completed" };
    expect(planAdminSessionSave(completed, { ...completed, status: "confirmed" }, { reason: "Not held" }))
      .toEqual({ ok: true, steps: [{ type: "rpc", fn: "admin_reopen_session", args: {
        p_kind: "coaching", p_session_id: "s1", p_reason: "Not held", p_start_time: null, p_duration_minutes: null } }] });
    expect(planAdminSessionSave(completed, { ...completed, status: "confirmed", topic: "x" }, { reason: "r" }))
      .toEqual({ ok: false, error: "detailsLocked" });
    expect(adminDetailsEditable("completed", "confirmed")).toBe(false);
  });

  it("completes through the canonical completion functions", () => {
    expect(planAdminSessionSave(base, { ...base, status: "completed" }, { reason: "" }))
      .toEqual({ ok: true, steps: [{ type: "rpc", fn: "complete_coaching_session", args: { p_session_id: "s1" } }] });
    const peer = { ...base, kind: "peer" as const };
    expect(planAdminSessionSave(peer, { ...peer, status: "completed" }, { reason: "" }))
      .toEqual({ ok: true, steps: [{ type: "rpc", fn: "transition_peer_session_status",
        args: { p_session_kind: "peer", p_session_id: "s1", p_status: "completed", p_reason: null } }] });
  });

  it("cancels through cancel-session and refuses detail edits alongside", () => {
    expect(planAdminSessionSave(base, { ...base, status: "cancelled" }, { reason: "", cancelReason: " Ill " }))
      .toEqual({ ok: true, steps: [{ type: "cancel", body: { session_id: "s1", is_peer: false, reason: "Ill" } }] });
    expect(planAdminSessionSave(base, { ...base, status: "cancelled", topic: "x" }, { reason: "r" }))
      .toEqual({ ok: false, error: "detailsLocked" });
  });

  it("confirms a pending Peer session through confirm_peer_session", () => {
    const pending = { ...base, kind: "peer" as const, status: "pending_coach_approval" };
    expect(planAdminSessionSave(pending, { ...pending, status: "confirmed" }, { reason: "" }))
      .toEqual({ ok: true, steps: [{ type: "rpc", fn: "confirm_peer_session",
        args: { p_session_id: "s1", p_meeting_url: null } }] });
  });
});
