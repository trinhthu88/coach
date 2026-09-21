/**
 * Programme module configuration.
 *
 * The programme answers WHAT a module is and HOW MANY units it requires.
 * It does not answer WHEN: that is the cohort's completion deadline, set in
 * Admin -> Cohorts and stored in cohort_module_deadlines.
 *
 * Distribution modes (evenly distributed / monthly / training-linked / custom /
 * flexible) are gone. They made the programme a second scheduling authority,
 * and "flexible" materialised a single requirement however many units the
 * programme required, which capped completion at one unit.
 *
 * distribution_settings survives for ONE thing: Training's training_week_ids,
 * which say which weeks the Training module covers. That is content scope, not
 * a schedule -- Training's dates come from the weeks themselves.
 */
export interface TrainingWeekSelection {
  training_week_ids: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeModuleScheduleConfig(config: Record<string, unknown>): Record<string, unknown> {
  // Retired keys were purged from stored configs (20260927300000).
  return {
    ...config,
    required: config.required === true,
    required_units: config.required_units ?? 0,
    weight: config.weight ?? null,
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

  const rawSettings = config.distribution_settings ?? {};
  if (!isRecord(rawSettings)) {
    return "programmes.modules.validation.distributionSettingsInvalid";
  }

  // Training week selection, when the module declares one.
  const ids = rawSettings.training_week_ids;
  if (ids !== undefined) {
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string" || id.length === 0) || new Set(ids).size !== ids.length) {
      return "programmes.modules.validation.trainingWeekIdsInvalid";
    }
    if (ids.length !== requiredUnits) {
      return "programmes.modules.validation.trainingWeeksInsufficient";
    }
    if (availableTrainingWeekIds && ids.some((id) => !availableTrainingWeekIds.includes(id as string))) {
      return "programmes.modules.validation.trainingWeekIdsInvalid";
    }
  }

  return null;
}
