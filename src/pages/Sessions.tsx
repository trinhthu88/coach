import { useEffect, useState, useCallback } from "react";
import { Link, useNavigate, Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { SessionRow } from "@/components/ui/proto";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Calendar,
  Clock,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Star,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { toast } from "sonner";
import type { Tables } from "@/integrations/supabase/types";
import type { LucideIcon } from "lucide-react";

type SessionStatus =
  | "pending_coach_approval"
  | "confirmed"
  | "completed"
  | "cancelled"
  | "rescheduled";

type SessionKind = "coaching" | "peer-give" | "peer-receive";

interface SessionRow {
  id: string;
  coach_id: string;
  coachee_id: string;
  topic: string;
  start_time: string;
  duration_minutes: number;
  status: SessionStatus;
  action_items: Tables<"sessions">["action_items"];
  coachee_rating: number | null;
  coachee_rating_comment: string | null;
  kind: SessionKind;
  coach: { full_name: string; email: string; avatar_url: string | null } | null;
  coachee: { full_name: string; email: string; avatar_url: string | null } | null;
}

function getStatusMeta(t: (key: string) => string): Record<SessionStatus, { label: string; icon: LucideIcon; className: string }> {
  return {
    pending_coach_approval: {
      label: t("status.pending_coach_approval"),
      icon: AlertCircle,
      className: "bg-warning/10 text-warning border-warning/20",
    },
    confirmed: {
      label: t("status.confirmed"),
      icon: CheckCircle2,
      className: "bg-primary/10 text-primary border-primary/20",
    },
    completed: {
      label: t("status.completed"),
      icon: CheckCircle2,
      className: "bg-success/10 text-success border-success/20",
    },
    cancelled: {
      label: t("status.cancelled"),
      icon: XCircle,
      className: "bg-destructive/10 text-destructive border-destructive/20",
    },
    rescheduled: {
      label: t("status.rescheduled"),
      icon: Clock,
      className: "bg-secondary text-secondary-foreground border-border",
    },
  };
}

export default function Sessions() {
  const { t } = useTranslation("sessions");
  const { user, role } = useAuth();
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("upcoming");

  const load = useCallback(async () => {
    if (!user) return;

    let sess: Tables<"sessions">[] = [];
    let peer: Tables<"peer_sessions">[] = [];

    if (role === "coach" || role === "coachee") {
      const col = role === "coach" ? "coach_id" : "coachee_id";
      const { data } = await supabase
        .from("sessions")
        .select("*")
        .eq(col, user.id)
        .order("start_time", { ascending: false });
      sess = data || [];
    }

    if (role === "coach") {
      const { data } = await supabase
        .from("peer_sessions")
        .select("*")
        .or(`peer_coach_id.eq.${user.id},peer_coachee_id.eq.${user.id}`)
        .order("start_time", { ascending: false });
      peer = data || [];
    }

    const allRows = [
      ...sess.map((s) => ({ ...s, kind: "coaching" as SessionKind })),
      ...peer.map((s) => ({
        ...s,
        coach_id: s.peer_coach_id,
        coachee_id: s.peer_coachee_id,
        kind: (s.peer_coach_id === user.id ? "peer-give" : "peer-receive") as SessionKind,
      })),
    ].sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime());

    const ids = Array.from(
      new Set(allRows.flatMap((s) => [s.coach_id, s.coachee_id]))
    );
    let byId = new Map<string, Pick<Tables<"profiles">, "id" | "full_name" | "email" | "avatar_url">>();
    if (ids.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, full_name, email, avatar_url")
        .in("id", ids);
      byId = new Map((profs || []).map((p) => [p.id, p]));
    }

    setSessions(
      allRows.map((s) => ({
        ...s,
        coach: byId.get(s.coach_id) || null,
        coachee: byId.get(s.coachee_id) || null,
      })) as SessionRow[]
    );
    setLoading(false);
  }, [user, role]);

  useEffect(() => {
    load();
  }, [load]);

  // Admins have a dedicated sessions view — redirect after hooks are called
  if (role === "admin") {
    return <Navigate to="/admin/sessions" replace />;
  }

  // Sponsors don't have personal coaching sessions of their own
  if (role === "sponsor") {
    return <Navigate to="/sponsor" replace />;
  }

  const now = new Date();
  const upcoming = sessions.filter(
    (s) => s.status !== "cancelled" && s.status !== "completed" && new Date(s.start_time) >= now
  );
  const past = sessions.filter(
    (s) => s.status === "completed" || s.status === "cancelled" || new Date(s.start_time) < now
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t("list.eyebrow")}
        title={t("list.titleLead")}
        emphasis={t("list.titleEmphasis")}

        subtitle={
          role === "coach"
            ? t("list.subtitleCoach")
            : t("list.subtitleCoachee")
        }
        actions={
          role === "coachee" && (
            <Button asChild className="shadow-glow">
              <Link to="/coaches">
                <Calendar className="mr-1 h-4 w-4" /> {t("list.bookASession")}
              </Link>
            </Button>
          )
        }
      />


      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="upcoming">{t("list.tabs.upcoming", { count: upcoming.length })}</TabsTrigger>
            <TabsTrigger value="past">{t("list.tabs.past", { count: past.length })}</TabsTrigger>
          </TabsList>
          <TabsContent value="upcoming" className="mt-4 space-y-3">
            {upcoming.length === 0 ? (
              <EmptyState
                title={t("list.empty.noUpcomingTitle")}
                subtitle={role === "coachee" ? t("list.empty.noUpcomingSubtitleCoachee") : t("list.empty.noUpcomingSubtitleCoach")}
              />
            ) : (
              upcoming.map((s) => (
                <SessionCard
                  key={`${s.kind}-${s.id}`}
                  session={s}
                  role={role!}
                  onOpen={() =>
                    navigate(
                      s.kind === "coaching"
                        ? `/sessions/${s.id}`
                        : `/sessions/${s.id}?type=peer`
                    )
                  }
                  onChanged={load}
                />
              ))
            )}
          </TabsContent>
          <TabsContent value="past" className="mt-4 space-y-3">
            {past.length === 0 ? (
              <EmptyState title={t("list.empty.noPastTitle")} subtitle={t("list.empty.noPastSubtitle")} />
            ) : (
              past.map((s) => (
                <SessionCard
                  key={`${s.kind}-${s.id}`}
                  session={s}
                  role={role!}
                  onOpen={() =>
                    navigate(
                      s.kind === "coaching"
                        ? `/sessions/${s.id}`
                        : `/sessions/${s.id}?type=peer`
                    )
                  }
                  onChanged={load}
                />
              ))
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

function EmptyState({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <Card className="p-12 text-center">
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
    </Card>
  );
}

function SessionCard({
  session,
  role,
  onOpen,
  onChanged,
}: {
  session: SessionRow;
  role: "coach" | "coachee" | "admin";
  onOpen: () => void;
  onChanged: () => void;
}) {
  const { t } = useTranslation("sessions");
  const meta = getStatusMeta(t)[session.status];
  const Icon = meta.icon;
  const isPeer = session.kind === "peer-give" || session.kind === "peer-receive";
  // For peer sessions: peer_coach (giver) acts as "coach", peer_coachee (receiver) acts as "coachee"
  const userIsPeerCoach = session.kind === "peer-give";
  const counterpart = isPeer
    ? userIsPeerCoach
      ? session.coachee
      : session.coach
    : role === "coach"
    ? session.coachee
    : session.coach;
  const start = new Date(session.start_time);
  const showRating =
    (!isPeer && role === "coachee" && session.status === "completed") ||
    (isPeer && !userIsPeerCoach && session.status === "completed");
  const canMarkComplete =
    ((isPeer && userIsPeerCoach) || (!isPeer && role === "coach")) &&
    session.status === "confirmed" &&
    start < new Date();
  const [completing, setCompleting] = useState(false);

  const markComplete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setCompleting(true);
    const table = isPeer ? "peer_sessions" : "sessions";
    const { error } = await supabase
      .from(table)
      .update({ status: "completed" })
      .eq("id", session.id);
    setCompleting(false);
    if (error) return toast.error(error.message);
    toast.success(t("list.toast.markedComplete"));
    onChanged();
  };

  const kindLabel = isPeer ? (userIsPeerCoach ? t("dashboard:coach.kindPill.peerGive") : t("dashboard:coach.kindPill.peerReceive")) : role === "coach" ? t("list.kindLabelWith") : t("list.kindLabelCoach");
  return (
    <Card className="overflow-hidden p-0">
      <SessionRow
        month={format(start, "MMM").toUpperCase()}
        day={format(start, "d")}
        title={session.topic}
        meta={`${kindLabel === "with" || kindLabel === "Coach" ? kindLabel : kindLabel} ${counterpart?.full_name || counterpart?.email || "—"} · ${format(start, "HH:mm")} · ${session.duration_minutes} min`}
        status={
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest",
              meta.className
            )}
          >
            <Icon className="h-3 w-3" /> {meta.label}
          </span>
        }
        onClick={onOpen}
        className="rounded-none border-0 shadow-none hover:border-0"
      />
      <div className="px-5 pb-5" onClick={(e) => e.stopPropagation()}>
        {canMarkComplete && (
          <Button size="sm" variant="secondary" onClick={markComplete} disabled={completing} className="mb-2">
            {completing ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Check className="mr-1 h-3 w-3" />}
            {t("list.markComplete")}
          </Button>
        )}
        <ActionItemsList items={session.action_items} date={session.start_time} />
        {showRating && (
          <div className="mt-4 border-t pt-3">
            <RateSession session={session} onChanged={onChanged} />
          </div>
        )}
      </div>
    </Card>
  );
}

function RateSession({ session, onChanged }: { session: SessionRow; onChanged: () => void }) {
  const { t } = useTranslation("sessions");
  const [rating, setRating] = useState<number>(session.coachee_rating || 0);
  const [hover, setHover] = useState(0);
  const [saving, setSaving] = useState(false);
  const isRated = !!session.coachee_rating;

  const submit = async (value: number) => {
    setSaving(true);
    setRating(value);
    const isPeer = session.kind === "peer-give" || session.kind === "peer-receive";
    const { error } = await supabase
      .from(isPeer ? "peer_sessions" : "sessions")
      .update({ coachee_rating: value, coachee_rated_at: new Date().toISOString() })
      .eq("id", session.id);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(isRated ? t("list.toast.ratingUpdated") : t("list.toast.ratingThanks"));
    onChanged();
  };

  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        {isRated ? t("list.rating.yourRating") : t("list.rating.rateThisSession")}
      </span>
      <div className="flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((n) => {
          const active = (hover || rating) >= n;
          return (
            <button
              key={n}
              type="button"
              disabled={saving}
              onMouseEnter={() => setHover(n)}
              onMouseLeave={() => setHover(0)}
              onClick={() => submit(n)}
              className="p-0.5 transition-transform hover:scale-110 disabled:opacity-50"
              aria-label={t("list.rating.rateStars", { count: n })}
            >
              <Star
                className={cn(
                  "h-5 w-5",
                  active ? "fill-warning text-warning" : "text-muted-foreground"
                )}
              />
            </button>
          );
        })}
      </div>
      {isRated && (
        <span className="text-xs text-muted-foreground">({rating}/5)</span>
      )}
    </div>
  );
}

interface ActionItem {
  text: string;
  done?: boolean;
}

function ActionItemsList({ items, date }: { items: Tables<"sessions">["action_items"]; date: string }) {
  const { t } = useTranslation("sessions");
  const list: ActionItem[] = Array.isArray(items)
    ? items
        .map((it) => (typeof it === "string" ? { text: it, done: false } : (it as unknown as ActionItem)))
        .filter((it): it is ActionItem => !!it?.text)
    : [];
  if (list.length === 0) return null;
  return (
    <div className="mt-4 border-t pt-3">
      <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        {t("list.actionItems.title")}
      </p>
      <ul className="space-y-1.5">
        {list.slice(0, 4).map((it, idx: number) => (
          <li key={idx} className="flex items-start justify-between gap-3 text-xs">
            <span className={cn("flex flex-1 items-start gap-1.5", it.done && "text-muted-foreground")}>
              <span className={cn("mt-0.5 inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center text-[10px]", it.done && "text-success font-bold")}>
                {it.done ? "✓" : "•"}
              </span>
              <span>{it.text}</span>
            </span>
            <span className="shrink-0 text-muted-foreground">
              {format(new Date(date), "MMM d, yyyy")}
            </span>
          </li>
        ))}
        {list.length > 4 && (
          <li className="text-[10px] text-muted-foreground">{t("list.actionItems.more", { count: list.length - 4 })}</li>
        )}
      </ul>
    </div>
  );
}
