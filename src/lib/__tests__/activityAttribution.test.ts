import { describe, expect, it } from "vitest";
import { resolveCadenceMilestone } from "../activityAttribution";

describe("resolveCadenceMilestone", () => {
  it("returns the exact qualifying enrollment milestone for new activity", () => {
    expect(
      resolveCadenceMilestone({
        enrollmentId: "enrollment-a",
        module: "coaching",
        activityId: "session-a",
        occurredOn: "2026-09-13",
        milestones: [
          { id: "milestone-a", module: "coaching", dueOn: "2026-09-13", requiredUnits: 1 },
        ],
      }),
    ).toEqual("milestone-a");
  });

  it("does not let later same-module activity mask an earlier missed checkpoint", () => {
    expect(
      resolveCadenceMilestone({
        enrollmentId: "enrollment-a",
        module: "coaching",
        activityId: "session-b",
        occurredOn: "2026-09-20",
        milestones: [
          { id: "milestone-a", module: "coaching", dueOn: "2026-09-13", requiredUnits: 1 },
          { id: "milestone-b", module: "coaching", dueOn: "2026-09-20", requiredUnits: 1 },
        ],
        alreadyAttributedMilestoneIds: ["milestone-a"],
      }),
    ).toEqual("milestone-b");
  });

  it("returns null for ambiguous or retired historical activity", () => {
    expect(
      resolveCadenceMilestone({
        enrollmentId: null,
        module: "coaching",
        activityId: "legacy-session",
        occurredOn: "2026-01-01",
        milestones: [],
        historical: true,
      }),
    ).toBeNull();
  });
});