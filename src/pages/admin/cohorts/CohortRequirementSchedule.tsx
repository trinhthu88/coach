import { useTranslation } from "react-i18next";
import { AlertTriangle, CalendarClock, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Pill } from "../_shared";
import { sortModuleDeadlines } from "@/lib/cohortSchedule";
import { moduleScopeLabelFor } from "@/components/programme/profileTheme";
import type { CohortRequirementScheduleState } from "@/hooks/admin/useCohortRequirementSchedule";

/**
 * Cohort requirement deadlines inside the Admin cohort dialog: BY WHEN each
 * programme module must be complete for this cohort.
 *
 * The programme says how many units a module requires; this says the one date
 * they are all due. The requirement rows themselves are materialised by the
 * database, so there is nothing per-unit here to type or regenerate. Every
 * Learner / Sponsor / Admin journey reads the result.
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
  const rows = sortModuleDeadlines(schedule.items);
  const multiProgramme = new Set(rows.map((r) => r.programme_id)).size > 1;

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

      {schedule.issues.length > 0 && (
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
        </ul>
      )}

      {schedule.loading ? (
        <div className="flex justify-center py-4">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
        </div>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-[11px] text-muted-foreground">
          {schedule.isNew ? t("cohorts.schedule.needProgrammeAndDates") : t("cohorts.schedule.empty")}
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          {rows.map((row) => {
            const key = `${row.programme_id}:${row.module}`;
            const edited = schedule.changedKeys.has(key);
            return (
              <div
                key={key}
                data-testid="schedule-module"
                data-module={row.module}
                className="flex flex-wrap items-center gap-2"
              >
                <span className="min-w-36 flex-1 text-[11px]">
                  <span className="font-medium">{moduleScopeLabelFor(row.module, tSponsor)}</span>{" "}
                  <span className="text-muted-foreground">
                    {t("cohorts.schedule.required", { count: row.required_units })}
                  </span>
                  {multiProgramme && programmeNames[row.programme_id]
                    ? ` · ${programmeNames[row.programme_id]}`
                    : ""}
                </span>
                <Input
                  type="date"
                  aria-label={t("cohorts.schedule.deadlineLabel", {
                    module: moduleScopeLabelFor(row.module, tSponsor),
                  })}
                  value={row.completion_deadline ?? ""}
                  onChange={(e) => e.target.value && schedule.setDeadline(row, e.target.value)}
                  className="h-8 w-40 text-[12px]"
                />
                {edited && <Pill tone="accent" className="shrink-0">{t("cohorts.schedule.edited")}</Pill>}
              </div>
            );
          })}
          <p className="text-[10.5px] text-muted-foreground">{t("cohorts.schedule.unitsNote")}</p>
          <p className="text-[10.5px] text-muted-foreground">{t("cohorts.schedule.trainingNote")}</p>
        </div>
      )}
    </section>
  );
}
