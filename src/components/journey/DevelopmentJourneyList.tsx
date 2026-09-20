import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import type { DevelopmentJourneyEvent, DevelopmentJourneyEventType } from "@/hooks/journey/developmentJourneyTypes";
import { JOURNEY_FILTERS, countByFilter, filterJourneyEvents, groupJourneyByMonth, type JourneyFilter } from "@/lib/developmentJourneyView";

/** Dot colour per event type (Coachee prototype JTONE). */
const DOT_BY_TYPE: Record<DevelopmentJourneyEventType, string> = {
  goal: "#2c8fa8",
  action: "#2c8fa8",
  coaching: "#062f3e",
  peer_coaching: "#8a6a2c",
  mentoring: "#6b5aa8",
  triad: "#b0703a",
  feedback: "#17663f",
  training: "#3db4d0",
  reflection: "#9a9287",
};

const MONTHS_STEP = 2;

/**
 * Development journey (Coachee prototype → My Journey): what has actually
 * happened, newest first — filter chips (All / Goals / Sessions / Training /
 * Reflections), month buckets, same-day runs grouped, "Show earlier".
 * Renders the canonical useEnrollmentDevelopmentJourney events only; it
 * never shows programme requirements or progress (that is Programme journey).
 */
export function DevelopmentJourneyList({ events, loading }: { events: DevelopmentJourneyEvent[]; loading?: boolean }) {
  const { t } = useTranslation("journey");
  const [filter, setFilter] = useState<JourneyFilter>("all");
  const [monthsShown, setMonthsShown] = useState(MONTHS_STEP);
  const [openRow, setOpenRow] = useState<string | null>(null);

  const counts = useMemo(() => countByFilter(events), [events]);
  const months = useMemo(() => groupJourneyByMonth(filterJourneyEvents(events, filter)), [events, filter]);
  const shown = months.slice(0, monthsShown);
  const hidden = months.length - shown.length;

  if (loading) {
    return <div data-testid="development-journey-loading" className="h-24 animate-pulse rounded-[13px] bg-[#eee8de]" />;
  }

  if (events.length === 0) {
    return (
      <p className="rounded-[13px] border border-dashed border-[#ddd6cc] bg-[#fbf8f2] p-4 text-center text-[12px] text-[#7d7468]">
        {t("developmentJourney.empty")}
      </p>
    );
  }

  return (
    <div data-testid="development-journey">
      <p className="text-[11.5px] text-[#7d7468]">{t("developmentJourney.summary", { count: filterJourneyEvents(events, filter).length })}</p>
      <div className="mt-[14px] flex flex-wrap gap-1.5" role="group" aria-label={t("developmentJourney.filterLabel")}>
        {JOURNEY_FILTERS.map((f) => {
          const on = f === filter;
          return (
            <button
              key={f}
              type="button"
              aria-pressed={on}
              onClick={() => {
                setFilter(f);
                setMonthsShown(MONTHS_STEP);
                setOpenRow(null);
              }}
              className={
                on
                  ? "rounded-full border border-[#062f3e] bg-[#062f3e] px-3 py-[7px] text-[10.5px] font-bold text-white"
                  : "rounded-full border border-[#e6e0d6] bg-white px-3 py-[7px] text-[10.5px] font-bold text-[#5d564d] hover:border-[#8bd3e3]"
              }
            >
              {t(`developmentJourney.filters.${f}`)} <span className="opacity-60">{counts[f]}</span>
            </button>
          );
        })}
      </div>

      {months.length === 0 ? (
        <p className="mt-4 text-[11.5px] text-[#7d7468]">{t("developmentJourney.filterEmpty")}</p>
      ) : (
        <div className="mt-4 flex flex-col gap-4">
          {shown.map((month) => (
            <div key={month.key} data-testid="journey-month">
              <div className="flex items-center gap-2.5">
                <div className="whitespace-nowrap text-[9px] font-extrabold uppercase tracking-[.18em] text-[#062f3e]">
                  {format(new Date(month.occurredAt), "MMMM yyyy")}
                </div>
                <div className="h-px flex-1 bg-[#e6e0d6]" />
                <div className="text-[9.5px] font-bold text-[#9a9287]">{t("developmentJourney.monthCount", { count: month.eventCount })}</div>
              </div>
              <ol className="mt-2.5 flex flex-col">
                {month.rows.map((row) => {
                  const grouped = row.events.length > 1;
                  const first = row.events[0];
                  const open = openRow === row.key;
                  const typeLabel = t(`developmentJourney.typeLabels.${row.type}`);
                  return (
                    <li
                      key={row.key}
                      data-testid="journey-event"
                      data-type={row.type}
                      className="grid grid-cols-[46px_16px_minmax(0,1fr)] items-start gap-[9px] border-b border-[#f3efe8] py-2"
                    >
                      <div className="whitespace-nowrap pt-0.5 text-[9.5px] font-bold text-[#9a9287]">{format(new Date(first.occurredAt), "d MMM")}</div>
                      <div className="pt-1">
                        <span className="block h-[9px] w-[9px] rounded-full" style={{ background: DOT_BY_TYPE[row.type] }} />
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-baseline gap-2">
                          <span className="text-[12px] font-semibold text-[#062f3e]">
                            {grouped ? t("developmentJourney.groupTitle", { count: row.events.length, type: typeLabel }) : first.title}
                          </span>
                          {grouped && (
                            <button
                              type="button"
                              aria-expanded={open}
                              onClick={() => setOpenRow(open ? null : row.key)}
                              className="rounded-full border border-[#e6e0d6] bg-[#fbf8f2] px-2 py-[3px] text-[9px] font-bold text-[#2c8fa8]"
                            >
                              {open ? t("developmentJourney.hide") : t("developmentJourney.items", { count: row.events.length })}
                            </button>
                          )}
                        </div>
                        <div className="mt-0.5 text-[10.5px] text-[#7d7468]">
                          {grouped ? typeLabel : [typeLabel, first.summary].filter(Boolean).join(" · ")}
                        </div>
                        {grouped && open && (
                          <div className="mt-[7px] flex flex-col gap-[5px]">
                            {row.events.map((e) => (
                              <div key={e.id} className="rounded-lg border border-[#efeae1] bg-[#fbf8f2] px-2.5 py-1.5 text-[10.5px] text-[#5d564d]">
                                {[e.title, e.summary].filter(Boolean).join(" · ")}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
        </div>
      )}

      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setMonthsShown((n) => n + MONTHS_STEP)}
          className="mt-4 w-full rounded-full border border-[#d8d1c6] px-[17px] py-2.5 text-[11px] font-bold text-[#062f3e] hover:border-[#8bd3e3]"
        >
          {t("developmentJourney.showEarlier", { count: hidden })}
        </button>
      )}
    </div>
  );
}
