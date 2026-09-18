import { describe, expect, it } from "vitest";
import { attachEnrollmentContext } from "../useSessionsData";

describe("attachEnrollmentContext", () => {
  it("adds programme and cohort labels from the row's enrollment without using dates", () => {
    const result = attachEnrollmentContext(
      [
        { id: "session-a", enrollment_id: "enrollment-a" },
        { id: "session-b", enrollment_id: "enrollment-b" },
      ],
      {
        "enrollment-a": { programmeName: "Programme A", cohortName: "Cohort A" },
        "enrollment-b": { programmeName: "Programme B", cohortName: null },
      }
    );

    expect(result).toEqual([
      { id: "session-a", enrollment_id: "enrollment-a", programmeName: "Programme A", cohortName: "Cohort A" },
      { id: "session-b", enrollment_id: "enrollment-b", programmeName: "Programme B", cohortName: null },
    ]);
  });

  it("leaves context unavailable when the canonical enrollment is unavailable", () => {
    const result = attachEnrollmentContext([{ id: "session-a", enrollment_id: "missing" }], {});

    expect(result[0]).toMatchObject({ programmeName: null, cohortName: null });
  });
});
