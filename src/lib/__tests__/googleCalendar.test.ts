import { describe, expect, it } from "vitest";
import { overlapsCalendarBusy } from "../googleCalendar";

describe("overlapsCalendarBusy", () => {
  const sessionStart = "2026-10-12T02:00:00.000Z";

  it("detects busy intervals that overlap any part of a session", () => {
    expect(overlapsCalendarBusy(sessionStart, 45, [
      { start: Date.parse("2026-10-12T02:40:00.000Z"), end: Date.parse("2026-10-12T03:10:00.000Z") },
    ])).toBe(true);
  });

  it("allows intervals that end exactly when the session starts", () => {
    expect(overlapsCalendarBusy(sessionStart, 45, [
      { start: Date.parse("2026-10-12T01:15:00.000Z"), end: Date.parse(sessionStart) },
    ])).toBe(false);
  });

  it("allows intervals that start exactly when the session ends", () => {
    expect(overlapsCalendarBusy(sessionStart, 45, [
      { start: Date.parse("2026-10-12T02:45:00.000Z"), end: Date.parse("2026-10-12T03:30:00.000Z") },
    ])).toBe(false);
  });
});
