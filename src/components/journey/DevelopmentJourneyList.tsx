import { useState } from "react";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { DevelopmentJourneyEvent } from "@/hooks/journey/developmentJourneyTypes";
import { ICON_BY_TYPE, TONE_BY_TYPE } from "@/pages/journey/developmentJourneyDisplay";

/**
 * The approved prototype's vertical, single connected-line Development
 * Journey presentation — one dot per event, in chronological order,
 * click-to-expand for the event's own summary. Same
 * useEnrollmentDevelopmentJourney events as the day-grouped
 * DevelopmentJourneyTimeline (still used by the coach's own My Journey);
 * this is a visual variant, not a second history query.
 */
export function DevelopmentJourneyList({ events, loading }: { events: DevelopmentJourneyEvent[]; loading?: boolean }) {
  const { t } = useTranslation("journey");
  const [openId, setOpenId] = useState<string | null>(null);

  if (loading) {
    return (
      <Card className="p-6">
        <div className="h-24 animate-pulse rounded-lg bg-muted/50" />
      </Card>
    );
  }

  if (events.length === 0) {
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground">{t("developmentJourney.empty")}</Card>
    );
  }

  return (
    <ol className="relative space-y-4 border-l border-border pl-6">
      {events.map((event) => {
        const Icon = ICON_BY_TYPE[event.type];
        const isOpen = openId === event.id;
        const canExpand = Boolean(event.summary);
        return (
          <li key={event.id} className="relative">
            <span
              className={cn(
                "absolute -left-[29px] top-0.5 grid h-5 w-5 place-items-center rounded-full border-2 border-card",
                TONE_BY_TYPE[event.type]
              )}
            >
              <Icon className="h-2.5 w-2.5" />
            </span>
            <button
              type="button"
              onClick={() => canExpand && setOpenId(isOpen ? null : event.id)}
              className={cn("w-full text-left", canExpand && "cursor-pointer")}
              disabled={!canExpand}
            >
              <p className="text-[8.5px] font-bold uppercase tracking-widest text-muted-foreground">
                {format(new Date(event.occurredAt), "d MMM yyyy")}
              </p>
              <p className="mt-1 text-[12.5px] font-semibold">{event.title}</p>
              {!isOpen && event.summary && (
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{event.summary}</p>
              )}
            </button>
            {isOpen && event.summary && (
              <div className="mt-2 rounded-lg bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
                {event.summary}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
