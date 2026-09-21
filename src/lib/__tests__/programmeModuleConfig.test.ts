import { describe, expect, it } from "vitest";
import { normalizeModuleScheduleConfig, validateModuleScheduleConfig } from "../programmeModuleConfig";

const validBase = {
  required: true,
  required_units: 3,
  weight: 1,
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

  it("accepts a requirement that says only how many units it needs", () => {
    expect(validateModuleScheduleConfig(validBase)).toBeNull();
  });

  it("rejects settings that are not an object", () => {
    expect(validateModuleScheduleConfig({
      ...validBase,
      distribution_settings: [] as unknown as Record<string, unknown>,
    })).toBe("programmes.modules.validation.distributionSettingsInvalid");
  });

  it("rejects an empty training-week selection for a required module", () => {
    expect(validateModuleScheduleConfig({
      ...validBase,
      distribution_settings: { training_week_ids: [] },
    })).toBe("programmes.modules.validation.trainingWeeksInsufficient");
  });

  it("accepts an unselected training module when no units are required", () => {
    expect(validateModuleScheduleConfig({
      required: false,
      required_units: 0,
      distribution_settings: { training_week_ids: [] },
    })).toBeNull();
  });

  it("rejects a training-week subset with fewer weeks than required units", () => {
    expect(validateModuleScheduleConfig({
      ...validBase,
      distribution_settings: { training_week_ids: ["week-1"] },
    })).toBe("programmes.modules.validation.trainingWeeksInsufficient");
  });

  it("accepts six training weeks when Admin defines six required training units", () => {
    expect(validateModuleScheduleConfig({
      ...validBase,
      required_units: 6,
      distribution_settings: { training_week_ids: ["week-1", "week-2", "week-3", "week-4", "week-5", "week-6"] },
    }, ["week-1", "week-2", "week-3", "week-4", "week-5", "week-6"])).toBeNull();
  });

  it("rejects malformed training-week selections", () => {
    expect(validateModuleScheduleConfig({
      ...validBase,
      distribution_settings: { training_week_ids: ["week-1", ""] },
    })).toBe("programmes.modules.validation.trainingWeekIdsInvalid");
  });
});


describe("normalizeModuleScheduleConfig", () => {
  it("adds the requirement defaults without dropping existing keys", () => {
    expect(normalizeModuleScheduleConfig({
      give_limit: 4,
      distribution_settings: { keep_me: true },
    })).toEqual({
      give_limit: 4,
      required: false,
      required_units: 0,
      weight: null,
      distribution_settings: { keep_me: true },
    });
  });

  it("normalizes the canonical fields (retired keys are purged from stored configs by 20260927300000)", () => {
    const normalized = normalizeModuleScheduleConfig({
      required: true,
      required_units: 6,
      distribution_settings: { training_week_ids: ["week-1"] },
    });
    expect(normalized).toMatchObject({
      required: true,
      required_units: 6,
      weight: null,
      distribution_settings: { training_week_ids: ["week-1"] },
    });
  });
});
