import { useTranslation } from "react-i18next";
import { AlertTriangle, CalendarClock, Loader2, RotateCcw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Pill } from "../_shared";
import {
  deadlineKey,
  displayedRequirementDate,
  groupRequirementDates,
  sortModuleDeadlines,
  type CohortModuleDeadline,
  type RequirementModuleGroup,
} from "@/lib/cohortSchedule";
import { moduleScopeLabelFor } from "@/components/programme/profileTheme";
import type { CohortRequirementScheduleState } from "@/hooks/admin/useCohortRequirementSchedule";

/**
 * Cohort requirement dates inside the Admin cohort dialog.
 *
 * The programme says how many units a module requires (N). The cohort holds N
 * requirement rows for it -- one per selected week for Training -- and each row
 * has its own date, shown and edited here. A session module also has a default
 * completion deadline: rows start at it and every row not dated individually
 * follows it. Every Learner / Sponsor / Admin figure (due, overdue,
 * checkpoints) is computed from exactly these dates.
 */
export function CohortRequirementSchedule({
  schedule,
  programmeNames,
  datesChanged,
}: {
  schedule: CohortRequirementScheduleState;
  programmeNames: Record<string, string>;
  /** The cohort's start/end in the form differ from the saved cohort. */
  datesChanged: boolean;
}) {
  const { t } = useTranslation("admin");
  const { t: tSponsor } = useTranslation("sponsor");
  const defaults = sortModuleDeadlines(schedule.items);
  const defaultsByKey = new Map(defaults.map((d) => [deadlineKey(d), d]));
  const groups = groupRequirementDates(schedule.requirements);
  const groupKeys = new Set(groups.map((g) => g.key));
  // A required module with no rows yet (e.g. no deadline) still shows its default.
  const emptyModules = defaults.filter((d) => !groupKeys.has(deadlineKey(d)));
  const multiProgramme = new Set([...defaults, ...schedule.requirements].map((r) => r.programme_id)).size > 1;
  const programmeSuffix = (programmeId: string) =>
    multiProgramme && programmeNames[programmeId] ? ` · ${programmeNames[programmeId]}` : "";

  const defaultDateInput = (row: CohortModuleDeadline) => (
    <Input
      type="date"
      aria-label={t("cohorts.schedule.deadlineLabel", { module: moduleScopeLabelFor(row.module, tSponsor) })}
      value={row.completion_deadline ?? ""}
      onChange={(e) => e.target.value && schedule.setDeadline(row, e.target.value)}
      className="h-8 w-40 text-[12px]"
    />
  );

  const renderGroup = (group: RequirementModuleGroup) => {
    const moduleDefault = defaultsByKey.get(group.key);
    const isTraining = group.module === "training";
    const required = moduleDefault?.required_units;
    const countMismatch = !isTraining && required != null && required !== group.rows.length;
    return (
      <div
        key={group.key}
        data-testid="schedule-module"
        data-module={group.module}
        className="rounded-md border border-border/60 p-2.5"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-36 flex-1 text-[11px]">
            <span className="font-semibold">{moduleScopeLabelFor(group.module, tSponsor)}</span>{" "}
            <span className="text-muted-foreground">
              {isTraining
                ? t("cohorts.schedule.selectedWeeks", { count: group.rows.length })
                : t("cohorts.schedule.required", { count: required ?? group.rows.length })}
            </span>
            {programmeSuffix(group.programme_id)}
          </span>
          {moduleDefault && (
            <>
              <span className="text-[10.5px] text-muted-foreground">{t("cohorts.schedule.defaultDeadline")}</span>
              {defaultDateInput(moduleDefault)}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-[11px]"
                onClick={() => schedule.applyDefaultToModule(group)}
              >
                {t("cohorts.schedule.applyToAll")}
              </Button>
              {schedule.changedKeys.has(group.key) && <Pill tone="accent" className="shrink-0">{t("cohorts.schedule.edited")}</Pill>}
            </>
          )}
        </div>
        {countMismatch && (
          <p data-testid="schedule-count-mismatch" className="mt-1.5 flex items-center gap-1.5 text-[11px] text-warning">
            <AlertTriangle className="h-3.5 w-3.5" />
            {t("cohorts.schedule.countMismatch", { required, scheduled: group.rows.length })}
          </p>
        )}
        <ol className="mt-2 space-y-1.5">
          {group.rows.map((row) => {
            const edit = schedule.requirementEdits[row.requirement_id];
            const custom = edit === undefined ? row.is_overridden : edit !== null;
            const pending = edit !== undefined;
            return (
              <li
                key={row.requirement_id}
                data-testid="schedule-requirement"
                data-module={row.module}
                className="flex flex-wrap items-center gap-2 pl-2"
              >
                <span className="min-w-40 flex-1 text-[11px]">
                  <span className="text-muted-foreground">{row.requirement_index}.</span> {row.requirement_label}
                </span>
                <Input
                  type="date"
                  aria-label={t("cohorts.schedule.requirementDateLabel", { requirement: row.requirement_label })}
                  value={displayedRequirementDate(row, edit)}
                  onChange={(e) => e.target.value && schedule.setRequirementDate(row.requirement_id, e.target.value)}
                  className="h-8 w-40 text-[12px]"
                />
                <Pill tone={custom ? "accent" : "muted"} className="shrink-0">
                  {custom ? t("cohorts.schedule.customDate") : t("cohorts.schedule.followsDefault")}
                </Pill>
                {custom && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-[11px]"
                    aria-label={t("cohorts.schedule.resetLabel", { requirement: row.requirement_label })}
                    onClick={() => schedule.resetRequirement(row.requirement_id)}
                  >
                    <RotateCcw className="h-3 w-3" /> {t("cohorts.schedule.reset")}
                  </Button>
                )}
                {pending && <Pill tone="accent" className="shrink-0">{t("cohorts.schedule.edited")}</Pill>}
              </li>
            );
          })}
        </ol>
      </div>
    );
  };

  return (
    <section data-testid="cohort-requirement-schedule" className="rounded-lg border border-border/70 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <CalendarClock className="h-4 w-4 text-primary" /> {t("cohorts.schedule.title")}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {schedule.isNew ? t("cohorts.schedule.subtitleNew") : t("cohorts.schedule.subtitleSaved")}
          </p>
        </div>
      </div>

      {!schedule.isNew && datesChanged && (
        <p data-testid="schedule-dates-changed" className="mt-2 rounded-md bg-warning/10 px-2.5 py-2 text-[11px] text-warning">
          {t("cohorts.schedule.datesChangedNote")}
        </p>
      )}

      {schedule.error && (
        <p role="alert" className="mt-2 flex items-center gap-1.5 text-[11px] text-destructive">
          <AlertTriangle className="h-3.5 w-3.5" /> {t("cohorts.schedule.loadError")}
        </p>
      )}

      {(schedule.issues.length > 0 || schedule.integrity.length > 0) && (
        <ul data-testid="schedule-issues" className="mt-2 space-y-1">
          {schedule.issues.map((issue) => (
            <li key={`${issue.programme_id}-${issue.module}-${issue.issue}`} className="flex items-center gap-1.5 text-[11px] text-warning">
              <AlertTriangle className="h-3.5 w-3.5" />
              {t(`cohorts.schedule.issues.${issue.issue}`, {
                module: moduleScopeLabelFor(issue.module, tSponsor),
                required: issue.required_units ?? 0,
                scheduled: issue.scheduled_units,
              })}
            </li>
          ))}
          {schedule.integrity.map((issue, i) => (
            <li key={`integrity-${issue.issue}-${i}`} className="flex items-center gap-1.5 text-[11px] text-warning">
              <AlertTriangle className="h-3.5 w-3.5" />
              {t(`cohorts.schedule.integrity.${issue.issue.replace(":", "_")}`, {
                module: issue.module ? moduleScopeLabelFor(issue.module, tSponsor) : "",
                detail: issue.detail,
                defaultValue: issue.detail,
              })}
            </li>
          ))}
        </ul>
      )}

      {schedule.loading ? (
        <div className="flex justify-center py-4">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
        </div>
      ) : defaults.length === 0 && groups.length === 0 ? (
        <p className="mt-3 text-[11px] text-muted-foreground">
          {schedule.isNew ? t("cohorts.schedule.needProgrammeAndDates") : t("cohorts.schedule.empty")}
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          {groups.map(renderGroup)}
          {emptyModules.map((row) => (
            <div
              key={deadlineKey(row)}
              data-testid="schedule-module"
              data-module={row.module}
              className="flex flex-wrap items-center gap-2 rounded-md border border-border/60 p-2.5"
            >
              <span className="min-w-36 flex-1 text-[11px]">
                <span className="font-semibold">{moduleScopeLabelFor(row.module, tSponsor)}</span>{" "}
                <span className="text-muted-foreground">{t("cohorts.schedule.required", { count: row.required_units })}</span>
                {programmeSuffix(row.programme_id)}
              </span>
              <span className="text-[10.5px] text-muted-foreground">{t("cohorts.schedule.defaultDeadline")}</span>
              {defaultDateInput(row)}
              {schedule.changedKeys.has(deadlineKey(row)) && <Pill tone="accent" className="shrink-0">{t("cohorts.schedule.edited")}</Pill>}
            </div>
          ))}
          <p className="text-[10.5px] text-muted-foreground">{t("cohorts.schedule.unitsNote")}</p>
          <p className="text-[10.5px] text-muted-foreground">
            {schedule.isNew ? t("cohorts.schedule.newCohortNote") : t("cohorts.schedule.trainingNote")}
          </p>
        </div>
      )}
    </section>
  );
}
