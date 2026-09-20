import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import { AlertTriangle, CalendarClock, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pill } from "../_shared";
import { groupRequirementItems } from "@/lib/cohortSchedule";
import { moduleScopeLabelFor } from "@/components/programme/profileTheme";
import type { CohortRequirementScheduleState } from "@/hooks/admin/useCohortRequirementSchedule";

const fmt = (iso: string | null) => (iso ? format(new Date(`${iso}T00:00:00`), "MMM d, yyyy") : "—");

/**
 * Cohort requirement schedule inside the Admin cohort dialog: WHEN each
 * programme requirement unit is due for this cohort. Proposed from the
 * programme's default policy for a new cohort; the saved canonical dates for
 * an existing one. Every Learner / Sponsor / Admin journey reads these saved
 * dates.
 */
export function CohortRequirementSchedule({
  schedule,
  programmeNames,
  datesChanged,
  canRegenerate,
}: {
  schedule: CohortRequirementScheduleState;
  programmeNames: Record<string, string>;
  /** The cohort's start/end in the form differ from the saved cohort. */
  datesChanged: boolean;
  canRegenerate: boolean;
}) {
  const { t } = useTranslation("admin");
  const { t: tSponsor } = useTranslation("sponsor");
  const groups = groupRequirementItems(schedule.items);
  const multiProgramme = new Set(groups.map((g) => g.programme_id)).size > 1;

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
        {!schedule.isNew && canRegenerate && (
          <Button type="button" variant="outline" size="sm" onClick={() => void schedule.startRegenerate()} disabled={schedule.loading}>
            <RefreshCw className="h-3.5 w-3.5" /> {t("cohorts.schedule.regenerate")}
          </Button>
        )}
      </div>

      {!schedule.isNew && datesChanged && !schedule.regenerated && (
        <p data-testid="schedule-dates-changed" className="mt-2 rounded-md bg-warning/10 px-2.5 py-2 text-[11px] text-warning">
          {t("cohorts.schedule.datesChangedNote")}
        </p>
      )}
      {schedule.regenerated && (
        <p className="mt-2 rounded-md bg-primary-soft px-2.5 py-2 text-[11px] text-primary">{t("cohorts.schedule.regeneratedNote")}</p>
      )}

      {schedule.review && (
        <div data-testid="schedule-regenerate-review" className="mt-3 rounded-md border border-primary/30 bg-primary-soft/40 p-3">
          <p className="text-[12px] font-semibold">{t("cohorts.schedule.reviewTitle")}</p>
          {schedule.review.changes.length === 0 ? (
            <p className="mt-1 text-[11px] text-muted-foreground">{t("cohorts.schedule.reviewNoChanges")}</p>
          ) : (
            <ul className="mt-2 space-y-1 text-[11px]">
              {schedule.review.changes.map((c) => (
                <li key={c.key} data-testid="schedule-change">
                  {moduleScopeLabelFor(c.module, tSponsor)} {c.ordinal}: <span className="text-muted-foreground line-through">{fmt(c.from)}</span> → <strong>{fmt(c.to)}</strong>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex gap-2">
            <Button type="button" size="sm" onClick={schedule.acceptRegenerate}>
              {t("cohorts.schedule.useRegenerated")}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={schedule.cancelRegenerate}>
              {t("cohorts.cancel")}
            </Button>
          </div>
        </div>
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
      ) : groups.length === 0 ? (
        <p className="mt-3 text-[11px] text-muted-foreground">
          {schedule.isNew ? t("cohorts.schedule.needProgrammeAndDates") : t("cohorts.schedule.empty")}
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          {groups.map((group) => (
            <div key={group.key} data-testid="schedule-module" data-module={group.module}>
              <p className="text-[10px] font-bold uppercase tracking-[.12em] text-muted-foreground">
                {moduleScopeLabelFor(group.module, tSponsor)} — {t("cohorts.schedule.required", { count: group.requiredUnits })}
                {multiProgramme && programmeNames[group.programme_id] ? ` · ${programmeNames[group.programme_id]}` : ""}
              </p>
              <ol className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
                {group.items.map((item) => {
                  const key = `${item.programme_id}:${item.module}:${item.ordinal}`;
                  const edited = schedule.changedKeys.has(key) || (!schedule.regenerated && item.is_overridden);
                  return (
                    <li key={key} className="flex items-center gap-2">
                      <span className="w-5 shrink-0 text-right text-[11px] text-muted-foreground">{item.ordinal}.</span>
                      <Input
                        type="date"
                        aria-label={t("cohorts.schedule.dateLabel", { module: moduleScopeLabelFor(item.module, tSponsor), n: item.ordinal })}
                        value={item.due_on}
                        onChange={(e) => e.target.value && schedule.setDate(item, e.target.value)}
                        className="h-8 text-[12px]"
                      />
                      {item.units > 1 && <span className="shrink-0 text-[10px] text-muted-foreground">×{item.units}</span>}
                      {edited && <Pill tone="accent" className="shrink-0">{t("cohorts.schedule.edited")}</Pill>}
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
          <p className="text-[10.5px] text-muted-foreground">{t("cohorts.schedule.trainingNote")}</p>
        </div>
      )}
    </section>
  );
}
