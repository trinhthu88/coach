import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useProgrammeWeeks } from "../useJourneyDerived";
import type { ProgrammeInfo } from "../types";

const baseProgramme: ProgrammeInfo = {
  enrollmentId: "enrollment-1",
  programmeName: "Emerging Leaders",
  cohortName: null,
  startDate: "2026-03-01",
  endDate: "2026-07-05",
  sessionsAllowed: 4,
  durationMonths: 5,
};

describe("useProgrammeWeeks", () => {
  it("derives total/elapsed weeks from the real enrollment start/end dates", () => {
    const now = new Date("2026-04-12T00:00:00Z");
    const { result } = renderHook(() => useProgrammeWeeks(baseProgramme, now));

    // 2026-03-01 -> 2026-07-05 is exactly 18 calendar weeks; nothing here is
    // read from durationMonths (5) or a fabricated fallback.
    expect(result.current?.totalWeeks).toBe(18);
    expect(result.current?.elapsedWeeks).toBeGreaterThan(0);
    expect(result.current?.elapsedWeeks).toBeLessThanOrEqual(18);
  });

  it("does not fabricate a duration from durationMonths when end_date is missing", () => {
    const now = new Date("2026-04-12T00:00:00Z");
    const programmeWithoutEndDate: ProgrammeInfo = { ...baseProgramme, endDate: null, durationMonths: 5 };
    const { result } = renderHook(() => useProgrammeWeeks(programmeWithoutEndDate, now));

    // Previously this returned a guessed { totalWeeks } computed from
    // start + durationMonths * 30 days. It must now report "unavailable"
    // instead of inventing a programme length.
    expect(result.current).toBeNull();
  });

  it("reports unavailable rather than a fabricated 3-month default when both duration fields are absent", () => {
    const now = new Date("2026-04-12T00:00:00Z");
    const bareProgramme: ProgrammeInfo = { ...baseProgramme, endDate: null, durationMonths: 0 };
    const { result } = renderHook(() => useProgrammeWeeks(bareProgramme, now));

    expect(result.current).toBeNull();
  });
});
