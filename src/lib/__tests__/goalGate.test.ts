import { describe, it, expect, vi } from "vitest";
import i18n from "@/i18n/config";
import { getFriendlyErrorMessage } from "@/lib/errors";
import {
  isGoalRequiredError,
  isGoalRequiredReason,
  isKeepOneGoalError,
  parseGoalGate,
} from "@/lib/goalGate";

const GATE_MESSAGE = "Create at least one goal first.";

// Shape PostgREST returns for assert_enrollment_goal_gate's RAISE ... USING
// ERRCODE 'P0001', DETAIL, HINT (20260926600000).
const gateError = {
  code: "P0001",
  message: "Create at least one goal first",
  details: '{"code": "goal_required_before_booking", "enrollment_id": "e1"}',
  hint: "Create at least one goal first.",
};

describe("booking goal gate — client contract", () => {
  it("recognises the server's gate rejection", () => {
    expect(isGoalRequiredError(gateError)).toBe(true);
    // Recognised by its machine code alone, or by the message alone.
    expect(isGoalRequiredError({ code: "P0001", message: "x", details: '{"code": "goal_required_before_booking"}' })).toBe(true);
    expect(isGoalRequiredError({ code: "P0001", message: "Create at least one goal first" })).toBe(true);
    expect(isGoalRequiredError({ code: "P0001", message: "something else" })).toBe(false);
    expect(isGoalRequiredError(null)).toBe(false);
  });

  it("maps a gated booking rejection to the exact gate sentence", async () => {
    await i18n.changeLanguage("en");
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(getFriendlyErrorMessage(gateError, i18n.t)).toBe(GATE_MESSAGE);
    // Even when the caller overrides generic codes, the rule's copy wins.
    expect(getFriendlyErrorMessage(gateError, i18n.t, { fallback: "fallback" })).toBe(GATE_MESSAGE);
  });

  it("maps the last-active-goal refusal to its own sentence", async () => {
    await i18n.changeLanguage("en");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const err = { code: "P0001", message: "last_active_goal_required" };
    expect(isKeepOneGoalError(err)).toBe(true);
    expect(getFriendlyErrorMessage(err, i18n.t)).toMatch(/at least one active goal/i);
  });

  it("recognises the Mentoring pre-check reason", () => {
    expect(isGoalRequiredReason("goal_required_before_booking")).toBe(true);
    expect(isGoalRequiredReason("ok")).toBe(false);
  });

  it("parses the gate payload and rejects malformed ones", () => {
    expect(
      parseGoalGate({
        enrollment_id: "e1",
        blocked: true,
        has_active_goal: false,
        active_goal_count: 0,
        max_active_goals: 3,
        goal_setup_deadline: "2026-09-08",
        goal_setup_overdue: true,
      }),
    ).toEqual({
      enrollmentId: "e1",
      blocked: true,
      hasActiveGoal: false,
      activeGoalCount: 0,
      maxActiveGoals: 3,
      goalSetupDeadline: "2026-09-08",
      goalSetupOverdue: true,
    });
    expect(parseGoalGate(null)).toBeNull();
    expect(parseGoalGate({ blocked: true })).toBeNull();
  });
});
