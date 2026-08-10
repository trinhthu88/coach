import { describe, it, expect } from "vitest";
import { canSubmitBooking, isOverSessionLimit } from "../bookingEligibility";

describe("isOverSessionLimit", () => {
  it("is false when usage is null (not yet loaded)", () => {
    expect(isOverSessionLimit(null)).toBe(false);
  });

  it("is false when used_this_month is below monthly_limit", () => {
    expect(isOverSessionLimit({ monthly_limit: 4, used_this_month: 3 })).toBe(false);
  });

  it("is true when used_this_month equals monthly_limit", () => {
    expect(isOverSessionLimit({ monthly_limit: 4, used_this_month: 4 })).toBe(true);
  });

  it("is true when used_this_month exceeds monthly_limit", () => {
    expect(isOverSessionLimit({ monthly_limit: 4, used_this_month: 5 })).toBe(true);
  });
});

describe("canSubmitBooking", () => {
  it("allows submission when date, start time, and topic are all set and eligible is true", () => {
    expect(
      canSubmitBooking({
        selectedDate: new Date(),
        selectedStart: "09:00",
        topic: "Career growth",
        eligible: true,
      })
    ).toBe(true);
  });

  it("blocks submission when no date is selected", () => {
    expect(
      canSubmitBooking({
        selectedDate: undefined,
        selectedStart: "09:00",
        topic: "Career growth",
        eligible: true,
      })
    ).toBe(false);
  });

  it("blocks submission when no start time is selected", () => {
    expect(
      canSubmitBooking({
        selectedDate: new Date(),
        selectedStart: null,
        topic: "Career growth",
        eligible: true,
      })
    ).toBe(false);
  });

  it("blocks submission when topic is empty", () => {
    expect(
      canSubmitBooking({
        selectedDate: new Date(),
        selectedStart: "09:00",
        topic: "",
        eligible: true,
      })
    ).toBe(false);
  });

  it("blocks submission when topic is only whitespace", () => {
    expect(
      canSubmitBooking({
        selectedDate: new Date(),
        selectedStart: "09:00",
        topic: "   ",
        eligible: true,
      })
    ).toBe(false);
  });

  it("blocks submission when the server (can_book_session) says eligible is false, even with valid inputs", () => {
    expect(
      canSubmitBooking({
        selectedDate: new Date(),
        selectedStart: "09:00",
        topic: "Career growth",
        eligible: false,
      })
    ).toBe(false);
  });

  it("allows submission when eligibility hasn't loaded yet (null) and other fields are valid", () => {
    expect(
      canSubmitBooking({
        selectedDate: new Date(),
        selectedStart: "09:00",
        topic: "Career growth",
        eligible: null,
      })
    ).toBe(true);
  });
});
