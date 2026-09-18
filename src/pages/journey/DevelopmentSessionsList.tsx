import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { Users, MessagesSquare, UserCog, Users2, type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { DevelopmentSessionItem, DevelopmentSessionType } from "@/hooks/journey/developmentSessionTypes";

const ICON_BY_TYPE: Record<DevelopmentSessionType, LucideIcon> = {
  coaching: Users,
  peer_coaching: MessagesSquare,
  mentoring: UserCog,
  triad: Users2,
};

const FILTERS: Array<DevelopmentSessionType | "all"> = ["all", "coaching", "peer_coaching", "mentoring", "triad"];

function detailPath(item: DevelopmentSessionItem): string | null {
  // SessionDetail resolves which table (sessions vs peer_sessions) to read
  // from its `?type=` query param — omitting it for a peer-coaching item
  // makes it look up the id in the wrong table and report "not found".
  if (item.type === "coaching") return `/sessions/${item.sourceId}`;
  if (item.type === "peer_coaching") return `/sessions/${item.sourceId}?type=peer`;
  if (item.type === "mentoring") return `/mentoring/sessions/${item.sourceId}`;
  if (item.type === "triad") return "/triads";
  return null;
}

/**
 * The learner's unified Sessions view: coaching, peer coaching, mentoring,
 * and triad, all read from useEnrollmentSessions (the same canonical
 * per-type tables the Development Journey timeline reads). Only a type
 * filter and presentation live here — status, dates, and counterparts are
 * exactly what the source row says.
 */
export function DevelopmentSessionsList({
  sessions,
  loading,
  programmeName,
  cohortName,
}: {
  sessions: DevelopmentSessionItem[];
  loading?: boolean;
  /** Every session here belongs to the one selected enrollment, so this is the
   * same programme/cohort for every row — passed once rather than re-fetched
   * per session, resolved via the enrollment (never inferred from date). */
  programmeName?: string | null;
  cohortName?: string | null;
}) {
  const { t } = useTranslation("journey");
  const [filter, setFilter] = useState<DevelopmentSessionType | "all">("all");

  const availableTypes = useMemo(() => new Set(sessions.map((s) => s.type)), [sessions]);
  const visibleFilters = FILTERS.filter((f) => f === "all" || availableTypes.has(f));
  const filtered = filter === "all" ? sessions : sessions.filter((s) => s.type === filter);

  if (loading) {
    return (
      <Card className="p-6">
        <div className="h-24 animate-pulse rounded-lg bg-muted/50" />
      </Card>
    );
  }

  if (sessions.length === 0) {
    return <Card className="p-6 text-center text-sm text-muted-foreground">{t("developmentSessions.empty")}</Card>;
  }

  return (
    <div className="space-y-3">
      {visibleFilters.length > 2 && (
        <div className="flex flex-wrap gap-1.5">
          {visibleFilters.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors",
                filter === f ? "border-primary bg-primary-soft text-primary" : "border-border text-muted-foreground hover:border-primary/40"
              )}
            >
              {t(`developmentSessions.filters.${f}`)}
            </button>
          ))}
        </div>
      )}

      <div className="space-y-2">
        {filtered.map((item) => {
          const Icon = ICON_BY_TYPE[item.type];
          const path = detailPath(item);
          const contextLabel = [item.trainingWeekLabel, item.roundLabel].filter(Boolean).join(" / ");
          const body = (
            <Card className="flex items-start gap-3 p-4 transition-colors hover:border-primary/40">
              <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary-soft text-primary">
                <Icon className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  {t(`developmentSessions.types.${item.type}`)}
                </p>
                <p className="truncate text-sm font-semibold">{contextLabel || item.title}</p>
                {(programmeName || cohortName) && (
                  <p className="truncate text-[11px] text-muted-foreground">
                    {[programmeName, cohortName].filter(Boolean).join(" · ")}
                  </p>
                )}
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {item.startTime ? format(new Date(item.startTime), "MMM d · p") : t("developmentSessions.timeTbd")}
                  {" · "}
                  {t(`developmentSessions.status.${item.status}`, { defaultValue: item.status })}
                  {item.counterpartName && ` · ${t("developmentSessions.withCounterpart", { name: item.counterpartName })}`}
                </p>
              </div>
            </Card>
          );
          return path ? (
            <Link key={item.id} to={path} className="block">
              {body}
            </Link>
          ) : (
            <div key={item.id}>{body}</div>
          );
        })}
      </div>
    </div>
  );
}
