import { describe, it, expect, vi } from "vitest";
import i18n from "@/i18n/config";
import { getFriendlyErrorMessage } from "@/lib/errors";
import {
  isGoalRequiredError,
  isGoalRequiredReason,
  isKeepOneGoalError,
  parseGoalGate,
} from "@/lib/goalGate";

const GATE_MESSAGE = "Create at least one programme goal before booking your next session.";

// Shape PostgREST returns for RAISE ... USING ERRCODE 'P0001', DETAIL, HINT.
const gateError = {
  code: "P0001",
  message: "goal_required_before_booking",
  details: '{"code": "goal_required_before_booking", "enrollment_id": "e1"}',
  hint: GATE_MESSAGE,
};

describe("booking goal gate — client contract", () => {
  it("recognises the server's gate rejection", () => {
    expect(isGoalRequiredError(gateError)).toBe(true);
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
        in_grace_period: false,
        grace_ends_on: "2026-09-07",
        blocked_from: "2026-09-08",
      }),
    ).toEqual({
      enrollmentId: "e1",
      blocked: true,
      hasActiveGoal: false,
      activeGoalCount: 0,
      maxActiveGoals: 3,
      inGracePeriod: false,
      graceEndsOn: "2026-09-07",
      blockedFrom: "2026-09-08",
    });
    expect(parseGoalGate(null)).toBeNull();
    expect(parseGoalGate({ blocked: true })).toBeNull();
  });
});
