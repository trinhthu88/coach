import { describe, expect, it } from "vitest";
import { programmeDayStart, programmeToday } from "../../../supabase/functions/_shared/programmeTime";

/** Edge Functions date "today" in Vietnam (decision 2), like programme_today(). */
describe("Edge Function programme time", () => {
  it("today is the Vietnamese date: 23:30 UTC on 14 Oct is 15 Oct", () => {
    expect(programmeToday(0, new Date("2026-10-14T23:30:00Z"))).toBe("2026-10-15");
    expect(programmeToday(0, new Date("2026-10-14T16:59:59Z"))).toBe("2026-10-14");
  });

  it("shifts by whole Vietnamese days", () => {
    const now = new Date("2026-10-14T23:30:00Z");
    expect(programmeToday(1, now)).toBe("2026-10-16");
    expect(programmeToday(-7, now)).toBe("2026-10-08");
  });

  it("a Vietnamese day starts at 17:00 UTC the day before", () => {
    expect(new Date(programmeDayStart("2026-10-15")).toISOString()).toBe("2026-10-14T17:00:00.000Z");
  });
});
