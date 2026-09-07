import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import { ChevronDown, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { useGroupReflections } from "@/hooks/triads/useTriadReflection";
import type { TriadRoundEntry } from "@/hooks/triads/useMyTriads";

/** Design's "past sessions" table card — one expandable row per completed/cancelled round. */
export function TriadPastSessionsTable({ rounds }: { rounds: TriadRoundEntry[] }) {
  return (
    <div className="overflow-hidden rounded-[20px] border border-[#e8e2d8] bg-card">
      {rounds.map((entry, i) => (
        <PastSessionRow key={entry.group.id} entry={entry} isLast={i === rounds.length - 1} />
      ))}
    </div>
  );
}

function PastSessionRow({ entry, isLast }: { entry: TriadRoundEntry; isLast: boolean }) {
  const { t } = useTranslation("triads");
  const [expanded, setExpanded] = useState(false);
  const { round, members, session, reflectionSubmitted } = entry;
  const { reflections } = useGroupReflections(expanded && session ? session.id : undefined);

  const memberNames = members.map((m) => m.full_name).join(", ");

  return (
    <div className={cn(!isLast && "border-b border-[#f4f0e9]")}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full flex-wrap items-center gap-3 px-[22px] py-[18px] text-left transition-colors hover:bg-[#faf8f4]"
      >
        <span className="w-[110px] shrink-0 text-[13.5px] font-semibold">
          {session?.proposed_start_time
            ? format(new Date(session.proposed_start_time), "MMM d, yyyy")
            : t("roundLabel", { n: round.round_number })}
        </span>
        <span className="flex-1 truncate text-[12.5px] text-muted-foreground">{memberNames}</span>
        <span
          className={cn(
            "text-[11.5px] font-semibold",
            reflectionSubmitted ? "text-success" : "text-[#c96830]"
          )}
        >
          {reflectionSubmitted ? t("pastSessions.submitted") : t("pastSessions.pending")}
        </span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-180")} />
      </button>

      {expanded && session && (
        <div className="space-y-3 px-[22px] pb-[18px]">
          {reflectionSubmitted && reflections.length === 0 && (
            <p className="text-xs italic text-muted-foreground">{t("reflection.othersLocked")}</p>
          )}
          {reflections.length > 0 && (
            <div>
              <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-[.16em] text-muted-foreground">
                {t("pastSessions.satisfaction")}
              </p>
              <div className="flex flex-wrap gap-3">
                {reflections.map((r) => (
                  <div key={r.id} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="font-semibold text-foreground">{r.profiles?.full_name}</span>
                    {r.satisfaction_rating != null && (
                      <span className="flex items-center gap-0.5">
                        {Array.from({ length: 5 }).map((_, i) => (
                          <Star
                            key={i}
                            className={cn(
                              "h-3.5 w-3.5",
                              i < r.satisfaction_rating! ? "fill-[#e8a33d] text-[#e8a33d]" : "text-[#d6cfc4]"
                            )}
                          />
                        ))}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          <Link
            to={`/triads/${session.id}/reflect`}
            className="inline-block text-[12.5px] font-semibold text-[#2c8fa8] hover:underline"
          >
            {reflectionSubmitted ? t("session.viewReflections") : t("session.submitReflection")} &rarr;
          </Link>
        </div>
      )}
    </div>
  );
}
