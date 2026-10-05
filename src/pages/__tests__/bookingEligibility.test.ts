import { describe, it, expect } from "vitest";
import { canSubmitBooking } from "../bookingEligibility";

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
