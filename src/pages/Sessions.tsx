import { useState } from "react";
import { Link, useNavigate, Navigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import type { EnrollmentActionItem } from "@/lib/enrollmentActions";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/ui/page-header";
import { SessionRow } from "@/components/ui/proto";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Calendar, Loader2, Star, Check, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { toast } from "sonner";
import { getSessionStatusPillMeta as getStatusMeta } from "@/lib/sessionStatusMeta";
import { useSessionsData } from "@/hooks/sessions/useSessionsData";
import type { SessionRow as SessionRowData, SessionKind } from "@/hooks/sessions/useSessionsData";

type KindFilter = "all" | "coaching" | "peer" | "mentoring";

// Collapses the 7 underlying kinds (which distinguish table + give/receive
// direction) down to the 3 categories a user actually filters by — direction
// doesn't matter for "show me my peer sessions".
function kindCategory(kind: SessionKind): KindFilter {
  if (kind === "coaching") return "coaching";
  if (kind === "mentoring-mentor" || kind === "mentoring-mentee") return "mentoring";
  return "peer";
}

function sessionDetailPath(s: { id: string; kind: SessionKind }): string {
  if (s.kind === "coaching") return `/sessions/${s.id}`;
  if (s.kind === "coachee-peer-give" || s.kind === "coachee-peer-receive") {
    return `/sessions/${s.id}?type=coachee_peer`;
  }
  if (s.kind === "mentoring-mentor" || s.kind === "mentoring-mentee") {
    return `/mentoring/sessions/${s.id}`;
  }
  return `/sessions/${s.id}?type=peer`;
}

export default function Sessions() {
  const { t } = useTranslation("sessions");
  const { user, role } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get("tab") || "upcoming";
  const searchTerm = searchParams.get("q") || "";
  const kindFilter = (searchParams.get("kind") as KindFilter) || "all";

  const { sessions, loading, reload: load } = useSessionsData(user?.id, role);

  const setTab = (v: string) => setSearchParams({ tab: v, q: searchTerm, kind: kindFilter }, { replace: true });
  const setSearchTerm = (v: string) => setSearchParams({ tab, q: v, kind: kindFilter }, { replace: true });
  const setKindFilter = (v: KindFilter) => setSearchParams({ tab, q: searchTerm, kind: v }, { replace: true });

  // Admins have a dedicated sessions view — redirect after hooks are called
  if (role === "admin") {
    return <Navigate to="/admin/sessions" replace />;
  }

  // Sponsors don't have personal coaching sessions of their own
  if (role === "sponsor") {
    return <Navigate to="/sponsor" replace />;
  }

  const q = searchTerm.trim().toLowerCase();
  const matchesFilters = (s: SessionRowData) =>
    (kindFilter === "all" || kindCategory(s.kind) === kindFilter) &&
    (!q ||
      s.topic.toLowerCase().includes(q) ||
      (s.coach?.full_name ?? "").toLowerCase().includes(q) ||
      (s.coach?.email ?? "").toLowerCase().includes(q) ||
      (s.coachee?.full_name ?? "").toLowerCase().includes(q) ||
      (s.coachee?.email ?? "").toLowerCase().includes(q));

  const now = new Date();
  const upcoming = sessions.filter(
    (s) => s.status !== "cancelled" && s.status !== "completed" && new Date(s.start_time) >= now && matchesFilters(s)
  );
  const past = sessions.filter(
    (s) => (s.status === "completed" || s.status === "cancelled" || new Date(s.start_time) < now) && matchesFilters(s)
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
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <SessionCardSkeleton key={i} />
          ))}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-64 max-w-xs flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder={t("list.searchPlaceholder")}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(["all", "coaching", "peer", "mentoring"] as const).map((k) => (
                <Badge
                  key={k}
                  variant={kindFilter === k ? "default" : "outline"}
                  className="cursor-pointer select-none"
                  onClick={() => setKindFilter(k)}
                >
                  {t(`list.kindFilter.${k}`)}
                </Badge>
              ))}
            </div>
          </div>

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
                  onOpen={() => navigate(sessionDetailPath(s))}
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
                  onOpen={() => navigate(sessionDetailPath(s))}
                  onChanged={load}
                />
              ))
            )}
          </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

function SessionCardSkeleton() {
  return (
    <Card className="flex items-center gap-4 p-4">
      <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-3 w-1/2" />
      </div>
      <Skeleton className="h-6 w-20 shrink-0 rounded-full" />
    </Card>
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
  session: SessionRowData;
  role: "coach" | "coachee" | "admin";
  onOpen: () => void;
  onChanged: () => void;
}) {
  const { t } = useTranslation("sessions");
  const meta = getStatusMeta(t)[session.status];
  const Icon = meta.icon;
  const isPeer = session.kind === "peer-give" || session.kind === "peer-receive";
  const isCoacheePeer = session.kind === "coachee-peer-give" || session.kind === "coachee-peer-receive";
  const isMentoring = session.kind === "mentoring-mentor" || session.kind === "mentoring-mentee";
  // For peer/mentoring sessions: the giver (peer-giver / mentor) acts as
  // "coach", the receiver (peer-receiver / mentee) acts as "coachee".
  const userIsGiver = session.kind === "peer-give" || session.kind === "coachee-peer-give" || session.kind === "mentoring-mentor";
  const counterpart = isPeer || isCoacheePeer || isMentoring
    ? userIsGiver
      ? session.coachee
      : session.coach
    : role === "coach"
    ? session.coachee
    : session.coach;
  const start = new Date(session.start_time);
  // mentoring_sessions has no rating column at all (mentors give written ICF
  // feedback instead, via mentoring_feedback on the dedicated detail page).
  const showRating =
    !isMentoring &&
    ((!isPeer && !isCoacheePeer && role === "coachee" && session.status === "completed") ||
      ((isPeer || isCoacheePeer) && !userIsGiver && session.status === "completed"));
  // Mentoring completion is hard-gated at the DB level on a submitted prep
  // file (enforce_mentoring_prep_file_before_completion) — the dedicated
  // /mentoring/sessions/:id page already has friendly handling for that
  // (P0001 → "prep file required" toast); this list's generic quick-action
  // doesn't, so mentoring sessions are completed from there instead.
  const canMarkComplete =
    !isMentoring &&
    ((isPeer || isCoacheePeer) ? userIsGiver : role === "coach") &&
    start < new Date() &&
    (session.status === "confirmed" ||
      // coachee_peer_sessions has no confirm step wired yet — let the provider
      // complete straight from pending_coach_approval (RULES.md §3 Relationship 5).
      (isCoacheePeer && session.status === "pending_coach_approval"));
  const [completing, setCompleting] = useState(false);

  const markComplete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setCompleting(true);
    const table = isCoacheePeer ? "coachee_peer_sessions" : isPeer ? "peer_sessions" : "sessions";
    const { error } = await supabase
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from(table as any)
      .update({ status: "completed" })
      .eq("id", session.id);
    setCompleting(false);
    if (error) return toast.error(error.message);
    toast.success(t("list.toast.markedComplete"));
    onChanged();
  };

  const kindLabel = isMentoring
    ? t("list.kindLabelMentoring")
    : isCoacheePeer
    ? t("list.kindLabelPeerPractice")
    : isPeer
    ? userIsGiver
      ? t("dashboard:coach.kindPill.peerGive")
      : t("dashboard:coach.kindPill.peerReceive")
    : role === "coach"
    ? t("list.kindLabelWith")
    : t("list.kindLabelCoach");
  const roleBadge = isMentoring
    ? userIsGiver
      ? { label: t("list.roleBadge.mentor"), className: "bg-success/10 text-success border-success/20" }
      : { label: t("list.roleBadge.mentee"), className: "bg-primary/10 text-primary border-primary/20" }
    : isCoacheePeer
    ? { label: t("list.roleBadge.coachee"), className: "bg-primary/10 text-primary border-primary/20" }
    : isPeer
    ? userIsGiver
      ? { label: t("list.roleBadge.coach"), className: "bg-success/10 text-success border-success/20" }
      : { label: t("list.roleBadge.coachee"), className: "bg-primary/10 text-primary border-primary/20" }
    : role === "coach"
    ? { label: t("list.roleBadge.coach"), className: "bg-success/10 text-success border-success/20" }
    : { label: t("list.roleBadge.coachee"), className: "bg-primary/10 text-primary border-primary/20" };
  return (
    <Card className="surface-card overflow-hidden p-0">
      <SessionRow
        month={format(start, "MMM").toUpperCase()}
        day={format(start, "d")}
        title={session.topic}
        meta={`${kindLabel === "with" || kindLabel === "Coach" ? kindLabel : kindLabel} ${counterpart?.full_name || counterpart?.email || "—"} · ${format(start, "HH:mm")} · ${session.duration_minutes} min`}
        status={
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span
              className={cn(
                "inline-flex max-w-[92px] items-center gap-1 whitespace-normal rounded-full border px-1.5 py-0.5 text-center text-[9px] font-bold uppercase leading-tight tracking-wide sm:max-w-none sm:shrink-0 sm:whitespace-nowrap sm:px-2.5 sm:py-1 sm:text-[10px] sm:tracking-widest",
                meta.className
              )}
            >
              <Icon className="h-3 w-3 shrink-0" /> {meta.label}
            </span>
            <Badge variant="outline" className={cn("text-[9px] font-bold uppercase tracking-widest", roleBadge.className)}>
              {roleBadge.label}
            </Badge>
          </div>
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
        <ActionItemsList items={session.enrollment_actions} date={session.start_time} />
        {showRating && (
          <div className="mt-4 border-t pt-3">
            <RateSession session={session} onChanged={onChanged} />
          </div>
        )}
      </div>
    </Card>
  );
}

function RateSession({ session, onChanged }: { session: SessionRowData; onChanged: () => void }) {
  const { t } = useTranslation("sessions");
  const [rating, setRating] = useState<number>(session.coachee_rating || 0);
  const [hover, setHover] = useState(0);
  const [saving, setSaving] = useState(false);
  const isRated = !!session.coachee_rating;

  const submit = async (value: number) => {
    setSaving(true);
    setRating(value);
    const isPeer = session.kind === "peer-give" || session.kind === "peer-receive";
    const isCoacheePeer = session.kind === "coachee-peer-give" || session.kind === "coachee-peer-receive";
    const table = isCoacheePeer ? "coachee_peer_sessions" : isPeer ? "peer_sessions" : "sessions";
    const update = isCoacheePeer
      ? { receiver_rating: value, receiver_rated_at: new Date().toISOString() }
      : { coachee_rating: value, coachee_rated_at: new Date().toISOString() };
    const { error } = await supabase
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from(table as any)
      .update(update)
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
      <div className="flex items-center gap-0.5" role="radiogroup" aria-label={t("list.rating.rateThisSession")}>
        {[1, 2, 3, 4, 5].map((n) => {
          const active = (hover || rating) >= n;
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={rating === n}
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

function ActionItemsList({ items, date }: { items: EnrollmentActionItem[]; date: string }) {
  const { t } = useTranslation("sessions");
  const list: ActionItem[] = items.filter((it) => !!it.text);
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
