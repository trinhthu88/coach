import { describe, expect, it } from "vitest";
import { normalizeModuleScheduleConfig, validateModuleScheduleConfig } from "../programmeModuleConfig";

const validBase = {
  required: true,
  required_units: 3,
  weight: 1,
  distribution_mode: "flexible",
  distribution_settings: {},
};

describe("validateModuleScheduleConfig", () => {
  it.each([
    [{ ...validBase, required_units: -1 }, "programmes.modules.validation.requiredUnitsWholeNonNegative"],
    [{ ...validBase, required_units: 1.5 }, "programmes.modules.validation.requiredUnitsWholeNonNegative"],
    [{ ...validBase, weight: -1 }, "programmes.modules.validation.weightNonNegative"],
    [{ ...validBase, required_units: 0 }, "programmes.modules.validation.requiredUnitsPositive"],
  ])("rejects invalid unit and weight constraints", (config, expected) => {
    expect(validateModuleScheduleConfig(config)).toBe(expected);
  });

  it("accepts a flexible coaching requirement without training weeks", () => {
    expect(validateModuleScheduleConfig(validBase)).toBeNull();
  });

  it("requires a positive whole monthly interval", () => {
    expect(validateModuleScheduleConfig({
      ...validBase,
      distribution_mode: "monthly_frequency",
      distribution_settings: { interval_months: 0 },
    })).toBe("programmes.modules.validation.monthlyIntervalPositive");
  });

  it("requires custom milestone units to equal required units", () => {
    expect(validateModuleScheduleConfig({
      ...validBase,
      distribution_mode: "custom",
      distribution_settings: {
        milestones: [
          { due_on: "2026-10-01", required_units: 1 },
          { due_on: "2026-11-01", window_end_on: "2026-11-08", required_units: 1 },
        ],
      },
    })).toBe("programmes.modules.validation.customUnitsMismatch");
  });

  it("accepts custom milestones whose units equal required units", () => {
    expect(validateModuleScheduleConfig({
      ...validBase,
      distribution_mode: "custom",
      distribution_settings: {
        milestones: [
          { due_on: "2026-10-01", required_units: 1 },
          { due_on: "2026-11-01", window_end_on: "2026-11-08", required_units: 2 },
        ],
      },
    })).toBeNull();
  });

  it("rejects an empty training-week selection for a required module", () => {
    expect(validateModuleScheduleConfig({
      ...validBase,
      distribution_mode: "training_linked",
      distribution_settings: { training_week_ids: [] },
    })).toBe("programmes.modules.validation.trainingWeeksInsufficient");
  });

  it("accepts an empty custom schedule when no units are required", () => {
    expect(validateModuleScheduleConfig({
      required: false,
      required_units: 0,
      distribution_mode: "custom",
      distribution_settings: { milestones: [] },
    })).toBeNull();
  });

  it("rejects an explicit training-week subset with fewer weeks than required units", () => {
    expect(validateModuleScheduleConfig({
      ...validBase,
      distribution_mode: "training_linked",
      distribution_settings: { training_week_ids: ["week-1"] },
    })).toBe("programmes.modules.validation.trainingWeeksInsufficient");
  });

  it("rejects malformed explicit training-week selections", () => {
    expect(validateModuleScheduleConfig({
      ...validBase,
      distribution_mode: "training_linked",
      distribution_settings: { training_week_ids: ["week-1", ""] },
    })).toBe("programmes.modules.validation.trainingWeekIdsInvalid");
  });
});


describe("normalizeModuleScheduleConfig", () => {
  it("adds persisted schedule defaults without dropping existing keys", () => {
    expect(normalizeModuleScheduleConfig({
      give_limit: 4,
      distribution_settings: { keep_me: true },
    })).toEqual({
      give_limit: 4,
      required: false,
      required_units: 0,
      weight: null,
      distribution_mode: "flexible",
      distribution_settings: { keep_me: true },
    });
  });
});
