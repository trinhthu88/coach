import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  MODULE_DISTRIBUTION_MODES,
  type CustomModuleMilestone,
  type ModuleDistributionMode,
} from "@/lib/programmeModuleConfig";

export interface TrainingWeekOption {
  id: string;
  weekNumber: number;
  title: string;
}

interface ProgrammeModuleScheduleFieldsProps {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  trainingWeeks?: TrainingWeekOption[];
}

function asSettings(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asMilestones(value: unknown): CustomModuleMilestone[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const milestone = asSettings(entry);
    return {
      due_on: typeof milestone.due_on === "string" ? milestone.due_on : "",
      required_units: typeof milestone.required_units === "number" ? milestone.required_units : 1,
      window_end_on: typeof milestone.window_end_on === "string" ? milestone.window_end_on : "",
    };
  });
}

export function ProgrammeModuleScheduleFields({
  config,
  onChange,
  trainingWeeks = [],
}: ProgrammeModuleScheduleFieldsProps) {
  const { t } = useTranslation("admin");
  const fieldId = useId();
  const settings = asSettings(config.distribution_settings);
  const mode = MODULE_DISTRIBUTION_MODES.includes(config.distribution_mode as ModuleDistributionMode)
    ? config.distribution_mode as ModuleDistributionMode
    : "flexible";
  const selectedWeekIds = Array.isArray(settings.training_week_ids)
    ? settings.training_week_ids.filter((id): id is string => typeof id === "string")
    : [];
  const milestones = asMilestones(settings.milestones);

  const updateConfig = (patch: Record<string, unknown>) => onChange({ ...config, ...patch });
  const updateSettings = (patch: Record<string, unknown>) => {
    updateConfig({ distribution_settings: { ...settings, ...patch } });
  };
  const updateMilestone = (index: number, patch: Partial<CustomModuleMilestone>) => {
    updateSettings({
      milestones: milestones.map((milestone, milestoneIndex) => (
        milestoneIndex === index ? { ...milestone, ...patch } : milestone
      )),
    });
  };
  const changeMode = (nextMode: ModuleDistributionMode) => {
    const nextSettings = { ...settings };
    if (nextMode === "monthly_frequency" && (
      typeof nextSettings.interval_months !== "number" || nextSettings.interval_months <= 0
    )) {
      nextSettings.interval_months = 1;
    }
    if (nextMode === "training_linked" && !Array.isArray(nextSettings.training_week_ids)) {
      nextSettings.training_week_ids = [];
    }
    if (nextMode === "custom" && !Array.isArray(nextSettings.milestones)) {
      nextSettings.milestones = [];
    }
    updateConfig({ distribution_mode: nextMode, distribution_settings: nextSettings });
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
        <div>
          <Label htmlFor={`${fieldId}-weight`} className="text-[10.5px] text-muted-foreground">
            {t("programmes.modules.schedule.weightOptional")}
          </Label>
          <Input
            id={`${fieldId}-weight`}
            type="number"
            min={0}
            step="any"
            value={typeof config.weight === "number" ? config.weight : ""}
            onChange={(event) => updateConfig({ weight: event.target.value === "" ? null : Number(event.target.value) })}
          />
        </div>
        <div>
          <Label htmlFor={`${fieldId}-mode`} className="text-[10.5px] text-muted-foreground">
            {t("programmes.modules.schedule.distributionMode")}
          </Label>
          <select
            id={`${fieldId}-mode`}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            value={mode}
            onChange={(event) => changeMode(event.target.value as ModuleDistributionMode)}
          >
            {MODULE_DISTRIBUTION_MODES.map((value) => (
              <option key={value} value={value}>{t(`programmes.modules.schedule.modes.${value}`)}</option>
            ))}
          </select>
        </div>
      </div>

      {mode === "monthly_frequency" && (
        <div className="max-w-48">
          <Label htmlFor={`${fieldId}-interval`} className="text-[10.5px] text-muted-foreground">
            {t("programmes.modules.schedule.monthlyInterval")}
          </Label>
          <Input
            id={`${fieldId}-interval`}
            type="number"
            min={1}
            step={1}
            value={typeof settings.interval_months === "number" ? settings.interval_months : 1}
            onChange={(event) => updateSettings({ interval_months: Number(event.target.value) })}
          />
        </div>
      )}

      {mode === "training_linked" && (
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

      {mode === "custom" && (
        <div className="space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10.5px] font-medium text-muted-foreground">
              {t("programmes.modules.schedule.customMilestones")}
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => updateSettings({
                milestones: [...milestones, { due_on: "", required_units: 1, window_end_on: "" }],
              })}
            >
              <Plus className="h-3.5 w-3.5" /> {t("programmes.modules.schedule.addMilestone")}
            </Button>
          </div>
          {milestones.map((milestone, index) => (
            <div key={index} className="grid items-end gap-2 rounded-lg border bg-background p-2 sm:grid-cols-[1fr_90px_1fr_auto]">
              <div>
                <Label htmlFor={`${fieldId}-due-${index}`} className="text-[10px] text-muted-foreground">
                  {t("programmes.modules.schedule.dueDate", { number: index + 1 })}
                </Label>
                <Input
                  id={`${fieldId}-due-${index}`}
                  type="date"
                  value={milestone.due_on}
                  onChange={(event) => updateMilestone(index, { due_on: event.target.value })}
                />
              </div>
              <div>
                <Label htmlFor={`${fieldId}-milestone-units-${index}`} className="text-[10px] text-muted-foreground">
                  {t("programmes.modules.schedule.milestoneUnits", { number: index + 1 })}
                </Label>
                <Input
                  id={`${fieldId}-milestone-units-${index}`}
                  type="number"
                  min={1}
                  step={1}
                  value={milestone.required_units}
                  onChange={(event) => updateMilestone(index, { required_units: Number(event.target.value) })}
                />
              </div>
              <div>
                <Label htmlFor={`${fieldId}-window-${index}`} className="text-[10px] text-muted-foreground">
                  {t("programmes.modules.schedule.windowEnd", { number: index + 1 })}
                </Label>
                <Input
                  id={`${fieldId}-window-${index}`}
                  type="date"
                  value={milestone.window_end_on ?? ""}
                  onChange={(event) => updateMilestone(index, { window_end_on: event.target.value })}
                />
              </div>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={t("programmes.modules.schedule.removeMilestone", { number: index + 1 })}
                onClick={() => updateSettings({ milestones: milestones.filter((_, milestoneIndex) => milestoneIndex !== index) })}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
