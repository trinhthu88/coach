import { describe, it, expect } from "vitest";
import { computeStartOptions, type DaySlot } from "../bookingSlots";
import { slotInstant } from "@/lib/slotTime";

const DATE = "2026-08-20";
// Busy times are instants; a slot's wall-clock time is Vietnam time.
const toEpoch = (hhmm: string) => slotInstant(DATE, hhmm).getTime();

const morningSlot: DaySlot = {
  id: "s1",
  slot_date: DATE,
  start_time: "09:00",
  end_time: "11:00",
};

describe("computeStartOptions", () => {
  it("returns every 15-minute-stepped start that fits the duration when nothing is busy", () => {
    const opts = computeStartOptions({
      dateKey: DATE,
      slots: [morningSlot],
      durationMinutes: 30,
      busy: [],
    });
    expect(opts.map((o) => o.start)).toEqual([
      "09:00", "09:15", "09:30", "09:45", "10:00", "10:15", "10:30",
    ]);
    expect(opts.every((o) => o.slotId === "s1")).toBe(true);
  });

  it("excludes a start that would exactly coincide with a busy interval", () => {
    const opts = computeStartOptions({
      dateKey: DATE,
      slots: [morningSlot],
      durationMinutes: 30,
      busy: [{ start: toEpoch("09:30"), end: toEpoch("10:00") }],
    });
    expect(opts.map((o) => o.start)).not.toContain("09:30");
  });

  it("excludes a start whose session would overlap the beginning of a busy interval", () => {
    const opts = computeStartOptions({
      dateKey: DATE,
      slots: [morningSlot],
      durationMinutes: 30,
      busy: [{ start: toEpoch("09:30"), end: toEpoch("10:00") }],
    });
    // 09:15-09:45 overlaps the 09:30-10:00 busy window's start
    expect(opts.map((o) => o.start)).not.toContain("09:15");
  });

  it("excludes a start whose session would overlap the end of a busy interval", () => {
    const opts = computeStartOptions({
      dateKey: DATE,
      slots: [morningSlot],
      durationMinutes: 30,
      busy: [{ start: toEpoch("09:30"), end: toEpoch("10:00") }],
    });
    // 09:45-10:15 overlaps the 09:30-10:00 busy window's end
    expect(opts.map((o) => o.start)).not.toContain("09:45");
  });

  it("allows a start that ends exactly when a busy interval begins", () => {
    const opts = computeStartOptions({
      dateKey: DATE,
      slots: [morningSlot],
      durationMinutes: 30,
      busy: [{ start: toEpoch("09:30"), end: toEpoch("10:00") }],
    });
    // 09:00-09:30 is back-to-back with busy starting at 09:30, not overlapping
    expect(opts.map((o) => o.start)).toContain("09:00");
  });

  it("allows a start that begins exactly when a busy interval ends", () => {
    const opts = computeStartOptions({
      dateKey: DATE,
      slots: [morningSlot],
      durationMinutes: 30,
      busy: [{ start: toEpoch("09:30"), end: toEpoch("10:00") }],
    });
    // 10:00-10:30 is back-to-back with busy ending at 10:00, not overlapping
    expect(opts.map((o) => o.start)).toContain("10:00");
  });

  it("excludes a start whose session would run past the availability window's end", () => {
    const opts = computeStartOptions({
      dateKey: DATE,
      slots: [{ id: "s2", slot_date: DATE, start_time: "09:00", end_time: "10:00" }],
      durationMinutes: 45,
      busy: [],
    });
    // 09:30 + 45min = 10:15, past the 10:00 window end
    expect(opts.map((o) => o.start)).toEqual(["09:00", "09:15"]);
  });

  it("filters out every start that conflicts across multiple busy intervals", () => {
    const opts = computeStartOptions({
      dateKey: DATE,
      slots: [{ id: "s3", slot_date: DATE, start_time: "09:00", end_time: "10:30" }],
      durationMinutes: 15,
      busy: [
        { start: toEpoch("09:15"), end: toEpoch("09:30") },
        { start: toEpoch("10:00"), end: toEpoch("10:15") },
      ],
    });
    expect(opts.map((o) => o.start)).toEqual([
      "09:00", "09:30", "09:45", "10:15",
    ]);
  });

  it("only returns options for the requested date, ignoring slots on other dates", () => {
    const opts = computeStartOptions({
      dateKey: DATE,
      slots: [
        morningSlot,
        { id: "other-day", slot_date: "2026-08-21", start_time: "09:00", end_time: "11:00" },
      ],
      durationMinutes: 30,
      busy: [],
    });
    expect(opts.every((o) => o.slotId === "s1")).toBe(true);
  });

  it("returns an empty array when there are no slots for the given date", () => {
    const opts = computeStartOptions({
      dateKey: DATE,
      slots: [],
      durationMinutes: 30,
      busy: [],
    });
    expect(opts).toEqual([]);
  });
});

describe("slot times are Vietnam time, whatever the browser's zone", () => {
  it("a slot's 09:00 is 02:00 UTC — what book_coaching_session / book_mentoring_session read", () => {
    expect(slotInstant("2026-10-08", "09:00").toISOString()).toBe("2026-10-08T02:00:00.000Z");
    expect(slotInstant("2026-10-14", "16:00").toISOString()).toBe("2026-10-14T09:00:00.000Z");
  });

  it("an existing session at 09:00 Vietnam time blocks the 09:00 start of that slot", () => {
    const at = (iso: string) => new Date(iso).getTime();
    const options = computeStartOptions({
      dateKey: "2026-10-08",
      slots: [{ id: "s9", slot_date: "2026-10-08", start_time: "09:00:00", end_time: "10:00:00" }],
      durationMinutes: 30,
      busy: [{ start: at("2026-10-08T02:00:00Z"), end: at("2026-10-08T02:30:00Z") }],
    });
    expect(options.map((o) => o.start)).toEqual(["09:30"]);
  });
});
