import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import type { Json } from "@/integrations/supabase/types";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { Goal, Milestone, RawActionItem, SessionSource } from "@/hooks/journey/types";
import type { FlatAction } from "@/hooks/journey/useFlatActionItems";
import { ActionRow } from "./ActionRow";

interface DisplaySession {
  id: string;
  topic: string;
  start_time: string;
  status: string;
  duration_minutes: number;
  action_items: Json;
  coachee_notes: string | null;
  _source?: SessionSource;
  _otherCoachId: string | null;
}

export function SessionsBlock<S extends DisplaySession>({
  title,
  items,
  expandable,
  milestones,
  goals,
  onToggleAction,
  coachNames,
  showSourceBadge,
}: {
  title: string;
  items: S[];
  expandable?: boolean;
  milestones?: Milestone[];
  goals?: Goal[];
  onToggleAction?: (a: FlatAction) => void;
  coachNames?: Record<string, string>;
  /** Shows a Peer/Coaching badge per session — used by the coach's own journey view. */
  showSourceBadge?: boolean;
}) {
  const { t } = useTranslation("journey");
  return (
    <Card className="p-4">
      <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        {title} · {items.length}
      </p>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("sessionsBlock.nothingHere")}</p>
      ) : (
        <div className="divide-y">
          {items.map((s) => {
            return (
              <SessionRow
                key={s._source ? `${s._source}-${s.id}` : s.id}
                s={s}
                expandable={expandable}
                milestones={milestones}
                goals={goals}
                onToggleAction={onToggleAction}
                coachName={s._otherCoachId ? coachNames?.[s._otherCoachId] : undefined}
                showSourceBadge={showSourceBadge}
              />
            );
          })}
        </div>
      )}
    </Card>
  );
}

function SessionRow<S extends DisplaySession>({
  s,
  expandable,
  milestones,
  goals,
  onToggleAction,
  coachName,
  showSourceBadge,
}: {
  s: S;
  expandable?: boolean;
  milestones?: Milestone[];
  goals?: Goal[];
  onToggleAction?: (a: FlatAction) => void;
  coachName?: string;
  showSourceBadge?: boolean;
}) {
  const { t } = useTranslation("journey");
  const [open, setOpen] = useState(false);
  const d = new Date(s.start_time);
  const items: RawActionItem[] = Array.isArray(s.action_items)
    ? s.action_items.map((it: Json) => (typeof it === "string" ? { text: it } : (it as unknown as RawActionItem)))
    : [];

  const labelFor = (mid?: string | null) => {
    if (!mid || !milestones || !goals) return undefined;
    const m = milestones.find((x) => x.id === mid);
    if (!m) return undefined;
    const g = goals.find((x) => x.id === m.goal_id);
    return g ? `${g.title} → ${m.title}` : m.title;
  };

  const source: SessionSource = s._source ?? "coaching";

  return (
    <div className="py-3">
      <div className="flex items-start gap-3">
        <div className="w-11 shrink-0 text-center">
          <p className="text-lg font-semibold leading-none">{format(d, "d")}</p>
          <p className="text-[10px] uppercase text-muted-foreground">{format(d, "MMM")}</p>
        </div>
        <div className="min-w-0 flex-1">
          <Link to={`/sessions/${s.id}`} className="text-sm font-medium hover:text-primary">
            {s.topic}
          </Link>
          <p className="text-[11px] text-muted-foreground">
            {format(d, "p")} · {s.duration_minutes}m{coachName ? ` · ${source === "peer" ? t("sessionsBlock.peerCoachPrefix") : t("sessionsBlock.coachPrefix")}: ${coachName}` : ""}
          </p>
          {showSourceBadge ? (
            <div className="mt-1 flex flex-wrap items-center gap-1">
              <StatusBadge status={s.status} withMargin={false} />
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                  source === "peer" ? "bg-warning/15 text-warning" : "bg-primary/15 text-primary"
                )}
              >
                {source === "peer" ? t("actionRow.sourcePeer") : t("actionRow.sourceCoaching")}
              </span>
              {expandable && (s.coachee_notes || items.length > 0) && (
                <button onClick={() => setOpen((o) => !o)} className="ml-1 text-[11px] text-primary hover:underline">
                  {open ? t("sessionsBlock.hideDetails") : t("sessionsBlock.showDetails")}
                </button>
              )}
            </div>
          ) : (
            <>
              <StatusBadge status={s.status} withMargin />
              {expandable && (s.coachee_notes || items.length > 0) && (
                <button
                  onClick={() => setOpen((o) => !o)}
                  className="ml-2 text-[11px] text-primary hover:underline"
                >
                  {open ? t("sessionsBlock.hideDetails") : t("sessionsBlock.showDetails")}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {expandable && open && (
        <div className="mt-2 ml-14 space-y-2 rounded-md bg-muted/30 p-3">
          {s.coachee_notes && (
            <>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {t("sessionsBlock.reflectionNote")}
              </p>
              <p className="text-xs italic text-muted-foreground">"{s.coachee_notes}"</p>
            </>
          )}
          {items.length > 0 && (
            <>
              <p className="mt-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {t("sessionsBlock.actionItemsFromSession")}
              </p>
              {items.map((it, i) => (
                <ActionRow
                  key={i}
                  a={{
                    ...it,
                    sessionId: s.id,
                    sessionTopic: s.topic,
                    sessionDate: s.start_time,
                    idx: i,
                    source,
                  } as FlatAction}
                  milestoneLabel={labelFor(it.milestone_id)}
                  onToggle={onToggleAction}
                  showSourceBadge={showSourceBadge}
                />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status, withMargin }: { status: string; withMargin?: boolean }) {
  return (
    <span
      className={cn(
        "inline-block rounded-full px-2 py-0.5 text-[10px] font-medium",
        withMargin && "mt-1",
        status === "completed" && "bg-success/15 text-success",
        status === "confirmed" && "bg-primary/15 text-primary",
        status === "cancelled" && "bg-destructive/15 text-destructive",
        status === "pending_coach_approval" && "bg-warning/15 text-warning"
      )}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}
