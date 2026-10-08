import { describe, expect, it } from "vitest";
import { slotDayBounds, slotInstant, slotTodayKey } from "../slotTime";

/**
 * One "today" (decision 2): the programme runs in Asia/Ho_Chi_Minh whatever
 * the browser's zone. A slot at 06:30 on 15 Oct in Vietnam is 23:30 UTC on
 * 14 Oct, and is still dated 15 Oct (20261006150000 on the server).
 */
describe("slot time is Vietnam time", () => {
  it("a 06:30 slot on 15 Oct is the instant 23:30 UTC on 14 Oct", () => {
    expect(slotInstant("2026-10-15", "06:30").toISOString()).toBe("2026-10-14T23:30:00.000Z");
  });

  it("today is the Vietnamese date, not the UTC one", () => {
    expect(slotTodayKey(new Date("2026-10-14T23:30:00Z"))).toBe("2026-10-15");
    expect(slotTodayKey(new Date("2026-10-14T16:59:00Z"))).toBe("2026-10-14");
    expect(slotTodayKey(new Date("2026-10-14T17:00:00Z"))).toBe("2026-10-15");
  });

  it("returns the UTC bounds of a Vietnam calendar day", () => {
    expect(slotDayBounds("2026-10-15")).toEqual({
      start: "2026-10-14T17:00:00.000Z",
      end: "2026-10-15T17:00:00.000Z",
    });
  });
});
