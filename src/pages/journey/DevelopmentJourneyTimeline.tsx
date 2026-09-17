import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import {
  Target,
  ListChecks,
  Users,
  MessagesSquare,
  UserCog,
  Users2,
  BookOpen,
  MessageSquareText,
  Star,
  type LucideIcon,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { DevelopmentJourneyEvent, DevelopmentJourneyEventType } from "@/hooks/journey/developmentJourneyTypes";

const ICON_BY_TYPE: Record<DevelopmentJourneyEventType, LucideIcon> = {
  goal: Target,
  action: ListChecks,
  coaching: Users,
  peer_coaching: MessagesSquare,
  mentoring: UserCog,
  triad: Users2,
  training: BookOpen,
  reflection: MessageSquareText,
  feedback: Star,
};

const TONE_BY_TYPE: Record<DevelopmentJourneyEventType, string> = {
  goal: "bg-primary-soft text-primary",
  action: "bg-success/15 text-success",
  coaching: "bg-accent/15 text-accent",
  peer_coaching: "bg-warning/15 text-warning",
  mentoring: "bg-accent/15 text-accent",
  triad: "bg-warning/15 text-warning",
  training: "bg-primary-soft text-primary",
  reflection: "bg-muted text-muted-foreground",
  feedback: "bg-success/15 text-success",
};

/**
 * Chronological Development Journey timeline: groups the shared
 * useEnrollmentDevelopmentJourney events by calendar day. Every entry is
 * traceable to its canonical source record (event.sourceType/sourceId) —
 * this component only formats and groups, it never invents a step.
 */
export function DevelopmentJourneyTimeline({ events, loading }: { events: DevelopmentJourneyEvent[]; loading?: boolean }) {
  const { t } = useTranslation("journey");

  const grouped = useMemo(() => {
    const map = new Map<string, DevelopmentJourneyEvent[]>();
    for (const event of events) {
      const key = event.occurredAt.slice(0, 10);
      const list = map.get(key) ?? [];
      list.push(event);
      map.set(key, list);
    }
    return Array.from(map.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [events]);

  if (loading) {
    return (
      <Card className="p-6">
        <div className="h-24 animate-pulse rounded-lg bg-muted/50" />
      </Card>
    );
  }

  if (grouped.length === 0) {
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground">
        {t("developmentJourney.empty")}
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {grouped.map(([day, items]) => (
        <div key={day} className="flex gap-4">
          <div className="w-16 shrink-0 pt-1 text-right text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
            {format(new Date(`${day}T00:00:00`), "d MMM")}
          </div>
          <div className="flex-1 space-y-2 border-l border-border pl-4">
            {items.map((event) => {
              const Icon = ICON_BY_TYPE[event.type];
              return (
                <div key={event.id} className="flex items-start gap-2.5">
                  <span className={cn("mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full", TONE_BY_TYPE[event.type])}>
                    <Icon className="h-3 w-3" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{event.title}</p>
                    {event.summary && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{event.summary}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
