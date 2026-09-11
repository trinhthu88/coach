export const MODULE_DISTRIBUTION_MODES = [
  "evenly_distributed",
  "monthly_frequency",
  "training_linked",
  "custom",
  "flexible",
] as const;

export type ModuleDistributionMode = (typeof MODULE_DISTRIBUTION_MODES)[number];

export interface CustomModuleMilestone {
  due_on: string;
  required_units: number;
  window_end_on?: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function normalizeModuleScheduleConfig(config: Record<string, unknown>): Record<string, unknown> {
  return {
    ...config,
    required: config.required === true,
    required_units: config.required_units ?? 0,
    weight: config.weight ?? null,
    distribution_mode: config.distribution_mode ?? "flexible",
    distribution_settings: isRecord(config.distribution_settings) ? { ...config.distribution_settings } : {},
  };
}

export function validateModuleScheduleConfig(
  config: Record<string, unknown>,
  availableTrainingWeekIds?: readonly string[],
): string | null {
  const requiredUnits = config.required_units ?? 0;
  if (typeof requiredUnits !== "number" || !Number.isInteger(requiredUnits) || requiredUnits < 0) {
    return "programmes.modules.validation.requiredUnitsWholeNonNegative";
  }

  const weight = config.weight;
  if (weight !== undefined && weight !== null && (typeof weight !== "number" || !Number.isFinite(weight) || weight < 0)) {
    return "programmes.modules.validation.weightNonNegative";
  }

  if (config.required === true && requiredUnits === 0) {
    return "programmes.modules.validation.requiredUnitsPositive";
  }

  const mode = config.distribution_mode ?? "flexible";
  if (!MODULE_DISTRIBUTION_MODES.includes(mode as ModuleDistributionMode)) {
    return "programmes.modules.validation.distributionModeInvalid";
  }

  const rawSettings = config.distribution_settings ?? {};
  if (!isRecord(rawSettings)) {
    return "programmes.modules.validation.distributionSettingsInvalid";
  }

  if (mode === "monthly_frequency") {
    const interval = rawSettings.interval_months;
    if (typeof interval !== "number" || !Number.isInteger(interval) || interval <= 0) {
      return "programmes.modules.validation.monthlyIntervalPositive";
    }
  }

  if (mode === "training_linked") {
    const ids = rawSettings.training_week_ids;
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string" || id.length === 0) || new Set(ids).size !== ids.length) {
      return "programmes.modules.validation.trainingWeekIdsInvalid";
    }
    if (Array.isArray(ids) && ids.length !== requiredUnits) {
      return "programmes.modules.validation.trainingWeeksInsufficient";
    }
    if (Array.isArray(ids) && availableTrainingWeekIds && ids.some((id) => !availableTrainingWeekIds.includes(id))) {
      return "programmes.modules.validation.trainingWeekIdsInvalid";
    }
  }

  if (mode === "custom") {
    const milestones = rawSettings.milestones;
    if (requiredUnits === 0 && (milestones === undefined || (Array.isArray(milestones) && milestones.length === 0))) return null;
    if (!Array.isArray(milestones) || milestones.length === 0) {
      return "programmes.modules.validation.customMilestonesRequired";
    }

    let totalUnits = 0;
    for (const milestone of milestones) {
      if (!isRecord(milestone) || !isIsoDate(milestone.due_on)) {
        return "programmes.modules.validation.customMilestoneInvalid";
      }
      if (
        typeof milestone.required_units !== "number"
        || !Number.isInteger(milestone.required_units)
        || milestone.required_units <= 0
      ) {
        return "programmes.modules.validation.customMilestoneInvalid";
      }
      if (
        milestone.window_end_on !== undefined
        && milestone.window_end_on !== null
        && milestone.window_end_on !== ""
        && (!isIsoDate(milestone.window_end_on) || milestone.window_end_on < milestone.due_on)
      ) {
        return "programmes.modules.validation.customMilestoneInvalid";
      }
      totalUnits += milestone.required_units;
    }

    if (totalUnits !== requiredUnits) {
      return "programmes.modules.validation.customUnitsMismatch";
    }
  }

  return null;
}
