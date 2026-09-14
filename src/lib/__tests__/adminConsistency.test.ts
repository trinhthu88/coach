import { describe, expect, it } from "vitest";
import { resolveCurrentEnrollment } from "../enrollmentResolver";

describe("resolveCurrentEnrollment", () => {
  it("deterministically prefers an active enrollment, then the latest start date", () => {
    expect(
      resolveCurrentEnrollment([
        { id: "completed", status: "completed", start_date: "2026-09-01" },
        { id: "active-old", status: "active", start_date: "2026-01-01" },
        { id: "active-new", status: "active", start_date: "2026-08-01" },
      ]),
    ).toEqual("active-new");
  });

  it("treats at-risk and paused records as current and chooses the latest start date when no active record exists", () => {
    expect(
      resolveCurrentEnrollment([
        { id: "paused", status: "paused", start_date: "2026-09-10" },
        { id: "at-risk", status: "at_risk", start_date: "2026-09-01" },
      ]),
    ).toEqual("paused");
  });

  it("returns null for unknown or empty enrollment sets", () => {
    expect(resolveCurrentEnrollment([])).toBeNull();
    expect(
      resolveCurrentEnrollment([{ id: "unknown", status: "mystery", start_date: "2026-09-01" }]),
    ).toBeNull();
  });
});