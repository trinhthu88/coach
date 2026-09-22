import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export interface TrainingWeekOption {
  id: string;
  weekNumber: number;
  title: string;
}

interface ProgrammeModuleScheduleFieldsProps {
  module: string;
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  trainingWeeks?: TrainingWeekOption[];
}

/** Child learning types a Training week can carry (canonical_learning_breakdown keys). */
const LEARNING_COMPONENTS = ["skill_cards", "quizzes", "reflections", "daily_prompts"] as const;

function asSettings(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/**
 * Programme -> module requirement: WHAT and HOW MANY.
 *
 * There is no schedule here any more. The programme used to carry a
 * distribution mode and its settings, which made it a second scheduling
 * authority; WHEN is now one completion deadline per module, set on the cohort.
 *
 * Training is the exception, and not a schedule: it needs to know WHICH weeks
 * the module covers. Those weeks carry their own dates.
 */
export function ProgrammeModuleScheduleFields({
  module,
  config,
  onChange,
  trainingWeeks = [],
}: ProgrammeModuleScheduleFieldsProps) {
  const { t } = useTranslation("admin");
  const fieldId = useId();
  const settings = asSettings(config.distribution_settings);
  const selectedWeekIds = Array.isArray(settings.training_week_ids)
    ? settings.training_week_ids.filter((id): id is string => typeof id === "string")
    : [];

  const learningComponents = Array.isArray(config.learning_components)
    ? config.learning_components.filter((k): k is string => typeof k === "string")
    : [];

  const updateConfig = (patch: Record<string, unknown>) => onChange({ ...config, ...patch });
  const updateSettings = (patch: Record<string, unknown>) => {
    updateConfig({ distribution_settings: { ...settings, ...patch } });
  };

  return (
    <div className="col-span-full mt-1 space-y-3 rounded-xl bg-muted/30 p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium">
            {config.required === true ? t("programmes.modules.schedule.required") : t("programmes.modules.schedule.optional")}
          </p>
          <p className="text-[10px] text-muted-foreground">{t("programmes.modules.schedule.requiredHint")}</p>
        </div>
        <Switch
          aria-label={t("programmes.modules.schedule.requiredToggle")}
          checked={config.required === true}
          onCheckedChange={(required) => updateConfig({ required })}
        />
      </div>

      <div className="grid gap-2.5 sm:grid-cols-3">
        <div>
          <Label htmlFor={`${fieldId}-units`} className="text-[10.5px] text-muted-foreground">
            {t("programmes.modules.schedule.requiredUnits")}
          </Label>
          <Input
            id={`${fieldId}-units`}
            type="number"
            min={0}
            step={1}
            value={typeof config.required_units === "number" ? config.required_units : 0}
            onChange={(event) => updateConfig({ required_units: Number(event.target.value) })}
          />
        </div>
      </div>

      <p className="text-[10px] text-muted-foreground" data-testid="module-deadline-note">
        {t("programmes.modules.schedule.deadlineNote")}
      </p>

      {module === "training" && (
        <fieldset className="space-y-2">
          <legend className="text-[10.5px] font-medium text-muted-foreground">
            {t("programmes.modules.schedule.trainingWeeks")}
          </legend>
          {trainingWeeks.length > 0 ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {trainingWeeks.map((week) => {
                const label = t("programmes.modules.schedule.trainingWeekOption", {
                  week: week.weekNumber,
                  title: week.title,
                });
                const checked = selectedWeekIds.includes(week.id);
                return (
                  <label key={week.id} className="flex items-center gap-2 text-[11px]">
                    <Checkbox
                      aria-label={label}
                      checked={checked}
                      onCheckedChange={(nextChecked) => updateSettings({
                        training_week_ids: nextChecked
                          ? [...selectedWeekIds, week.id]
                          : selectedWeekIds.filter((id) => id !== week.id),
                      })}
                    />
                    {label}
                  </label>
                );
              })}
            </div>
          ) : (
            <p className="text-[10px] text-muted-foreground">{t("programmes.modules.schedule.noTrainingWeeks")}</p>
          )}
          <p className="text-[10px] text-muted-foreground">{t("programmes.modules.schedule.allTrainingWeeksHint")}</p>
        </fieldset>
      )}

      {module === "training" && (
        // Which child learning types count as evidence inside each selected
        // week (config.learning_components). They never add programme units:
        // Training stays "completed weeks / selected weeks".
        <fieldset className="space-y-2" data-testid="learning-components">
          <legend className="text-[10.5px] font-medium text-muted-foreground">
            {t("programmes.modules.schedule.learningComponents")}
          </legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {LEARNING_COMPONENTS.map((key) => {
              const label = t(`programmes.modules.schedule.learningComponent.${key}`);
              const locked = key === "skill_cards";
              return (
                <label key={key} className="flex items-center gap-2 text-[11px]">
                  <Checkbox
                    aria-label={label}
                    checked={locked || learningComponents.includes(key)}
                    disabled={locked}
                    onCheckedChange={(nextChecked) => updateConfig({
                      learning_components: LEARNING_COMPONENTS.filter((k) =>
                        k === "skill_cards" || (k === key ? nextChecked === true : learningComponents.includes(k))),
                    })}
                  />
                  {label}
                </label>
              );
            })}
          </div>
          <p className="text-[10px] text-muted-foreground">{t("programmes.modules.schedule.learningComponentsHint")}</p>
        </fieldset>
      )}
    </div>
  );
}
