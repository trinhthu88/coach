import { describe, expect, it } from "vitest";
import { isCoachEligible } from "../coachEligibility";

describe("isCoachEligible", () => {
  it("requires both an active account and approved Coach profile", () => {
    expect(isCoachEligible({ accountStatus: "active", approvalStatus: "active" })).toBe(true);
    expect(isCoachEligible({ accountStatus: "pending_approval", approvalStatus: "active" })).toBe(false);
    expect(isCoachEligible({ accountStatus: "active", approvalStatus: "pending_approval" })).toBe(false);
  });

  it("fails closed for missing or unknown status values", () => {
    expect(isCoachEligible({ accountStatus: null, approvalStatus: "active" })).toBe(false);
    expect(isCoachEligible({ accountStatus: "active", approvalStatus: null })).toBe(false);
    expect(isCoachEligible({ accountStatus: "active", approvalStatus: "mystery" })).toBe(false);
  });
});