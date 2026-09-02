import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { StatCard } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Clock, CheckCircle2, Users, CalendarCheck, Star, Video, ArrowUpRight, Search } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useCoachDashboardData } from "@/hooks/dashboard/useCoachDashboardData";
import type { SessionLite } from "@/hooks/dashboard/useCoacheeDashboardData";
import { ThisWeekSkillCard } from "@/components/training/ThisWeekSkillCard";
import { DailyPromptCard } from "@/components/training/DailyPromptCard";

export function CoachDashboardView({ userId }: { userId: string }) {
  const { t } = useTranslation("dashboard");
  const {
    sessions,
    peerSessions,
    profilesById,
    loading,
    actingId,
    actingAction,
    peerOptIn,
    coachProfile,
    approve,
    decline,
  } = useCoachDashboardData(userId);

  const now = new Date();
  const upcoming = sessions.filter(
    (s) => s.status === "confirmed" && new Date(s.start_time) >= now
  );
  const nextSession = upcoming
    .slice()
    .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())[0];
  const pendingRequests = sessions.filter((s) => s.status === "pending_coach_approval");
  const peerPending = peerSessions.filter(
    (s) => s.status === "pending_coach_approval" && s.peer_coach_id === userId
  );
  const completed = sessions.filter((s) => s.status === "completed");
  const peerCompleted = peerSessions.filter((s) => s.status === "completed");
  const activeClients = new Set(
    sessions.filter((s) => ["confirmed", "completed"].includes(s.status)).map((s) => s.coachee_id)
  ).size;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const nextCoachee = nextSession ? profilesById[nextSession.coachee_id] : null;

  // Combined upcoming feed for the "Sessions" card on the dashboard
  const mixedUpcoming = [
    ...sessions
      .filter((s) => s.status === "confirmed" && new Date(s.start_time) >= now)
      .map((s) => ({
        id: s.id,
        topic: s.topic,
        start_time: s.start_time,
        kind: "coaching" as const,
        counterpart: profilesById[s.coachee_id]?.full_name || t("coach.bookingRequests.defaultCoachee"),
      })),
    ...peerSessions
      .filter((s) => s.status === "confirmed" && new Date(s.start_time) >= now)
      .map((s) => {
        const isCoaching = s.peer_coach_id === userId;
        const counterpartId = isCoaching ? s.peer_coachee_id : s.peer_coach_id;
        return {
          id: s.id,
          topic: s.topic,
          start_time: s.start_time,
          kind: (isCoaching ? "peer-give" : "peer-receive") as "peer-give" | "peer-receive",
          counterpart: profilesById[counterpartId]?.full_name || t("coach.peerRequests.defaultPeer"),
        };
      }),
  ]
    .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
    .slice(0, 6);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-3xl tracking-tight text-secondary">
            {t("coach.workspace.titleLead")} <em className="not-italic text-primary">{t("coach.workspace.titleEmphasis")}</em>
          </h2>
          <p className="text-sm text-muted-foreground">
            {t("coach.workspace.subtitle")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link to="/coach/profile">{t("coach.workspace.editProfile")}</Link>
          </Button>
          <Button asChild className="shadow-glow">
            <Link to="/coach/availability">{t("coach.workspace.setAvailability")}</Link>
          </Button>
        </div>
      </div>

      {/* Role indicators */}
      <section className="grid gap-3 sm:grid-cols-3">
        <RoleIndicator
          tone="primary"
          label={t("coach.roleIndicators.coaching")}
          desc={t("coach.roleIndicators.activeClients", { count: activeClients })}
        />
        <RoleIndicator
          tone="success"
          label={t("coach.roleIndicators.peerCoaching")}
          desc={peerOptIn ? t("coach.roleIndicators.availableForPeers") : t("coach.roleIndicators.notOptedIn")}
        />
        <RoleIndicator
          tone="accent"
          label={t("coach.roleIndicators.coachee")}
          desc={t("coach.roleIndicators.openToBeingCoached")}
        />
      </section>

      {/* Stats */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={t("coach.stats.sessionsCompleted")}
          value={String(completed.length)}
          hint={t("coach.stats.sessionsCompletedHint")}
          icon={CheckCircle2}
        />
        <StatCard
          label={t("coach.stats.peerSessions")}
          value={String(peerCompleted.length)}
          hint={t("coach.stats.peerSessionsHint")}
          icon={Users}
        />
        <StatCard
          label={t("coach.stats.upcoming")}
          value={String(
            upcoming.length +
              peerSessions.filter((s) => s.status === "confirmed" && new Date(s.start_time) >= now)
                .length
          )}
          hint={t("coach.stats.upcomingHint")}
          icon={CalendarCheck}
        />
        <StatCard
          label={t("coach.stats.avgRating")}
          value={(coachProfile?.rating_avg ?? 5).toFixed(1)}
          hint={t("coach.stats.avgRatingHint")}
          icon={Star}
        />
      </section>

      <section className="grid gap-5 lg:grid-cols-3">
        {/* Next session */}
        <div className="lg:col-span-2" data-onboarding="dashboard-next-session">
          <NextSessionCard
            session={
              nextSession
                ? ({
                    ...nextSession,
                    meeting_url: nextSession.meeting_url,
                    coach_id: userId,
                    action_items: null,
                  } as SessionLite)
                : undefined
            }
            coach={nextCoachee || null}
          />
        </div>

        {/* Pending peer requests */}
        <Card className="p-5">
          <p className="mb-3 inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-success">
            <Clock className="h-3.5 w-3.5" /> {t("coach.peerRequests.title")}
          </p>
          {peerPending.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {peerOptIn
                ? t("coach.peerRequests.noneAvailable")
                : t("coach.peerRequests.noneOptedIn")}
            </p>
          ) : (
            <>
              <ul className="space-y-2">
                {peerPending.slice(0, 4).map((s) => {
                  const p = profilesById[s.peer_coachee_id];
                  return (
                    <li key={s.id}>
                      <Link
                        to={`/sessions/${s.id}`}
                        className="block rounded-lg border border-success/30 bg-success/5 p-3 transition-colors hover:bg-success/10"
                      >
                        <p className="text-sm font-semibold">{p?.full_name || t("coach.peerRequests.defaultPeer")}</p>
                        <p className="text-xs text-muted-foreground">{s.topic}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {format(new Date(s.start_time), "MMM d · p")}
                        </p>
                      </Link>
                    </li>
                  );
                })}
              </ul>
              <div className="mt-3">
                <Button asChild variant="outline" size="sm">
                  <Link to="/sessions">
                    {t("coach.peerRequests.reviewInSessions")} <ArrowUpRight className="ml-1 h-3 w-3" />
                  </Link>
                </Button>
              </div>
            </>
          )}
        </Card>
      </section>

      {/* Booking requests */}
      <section data-onboarding="dashboard-booking-requests">
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <p className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
              <Clock className="h-3.5 w-3.5" /> {t("coach.bookingRequests.title")}
            </p>
            {pendingRequests.length > 0 && (
              <Badge className="bg-warning/15 text-warning hover:bg-warning/15">
                {t("coach.bookingRequests.new", { count: pendingRequests.length })}
              </Badge>
            )}
          </div>
          {pendingRequests.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("coach.bookingRequests.none")}</p>
          ) : (
            <ul className="divide-y">
              {pendingRequests.map((s) => {
                const p = profilesById[s.coachee_id];
                const initials = (p?.full_name || "?")
                  .split(" ")
                  .map((n) => n[0])
                  .join("")
                  .slice(0, 2)
                  .toUpperCase();
                return (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-soft text-xs font-bold text-primary">
                        {initials}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{p?.full_name || t("coach.bookingRequests.defaultCoachee")}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {s.topic} · {s.duration_minutes}m
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {format(new Date(s.start_time), "MMM d, yyyy · p")}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => approve(s)}
                        disabled={actingId === s.id}
                      >
                        {actingId === s.id && actingAction === "approve" ? (
                          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                        )}
                        {t("coach.bookingRequests.approve")}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => decline(s)}
                        disabled={actingId === s.id}
                      >
                        {actingId === s.id && actingAction === "decline" && (
                          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                        )}
                        {t("coach.bookingRequests.decline")}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </section>

      {/* Mixed upcoming sessions */}
      <section className="grid gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
            {t("coach.upcomingSessions.title")}
          </p>
          {mixedUpcoming.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("coach.upcomingSessions.none")}</p>
          ) : (
            <ul className="divide-y">
              {mixedUpcoming.map((s) => (
                <li key={`${s.kind}-${s.id}`} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <KindPill kind={s.kind} />
                      <p className="truncate font-semibold">{s.topic}</p>
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {t("coach.upcomingSessions.withPrefix")} {s.counterpart} · {format(new Date(s.start_time), "MMM d, yyyy · p")}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-5">
          <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
            {t("coach.practiceJourneyPreview.title")}
          </p>
          {peerCompleted.length === 0 && completed.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("coach.practiceJourneyPreview.empty")}
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              <li className="flex justify-between">
                <span className="text-muted-foreground">{t("coach.practiceJourneyPreview.sessionsDelivered")}</span>
                <span className="font-semibold">{completed.length}</span>
              </li>
              <li className="flex justify-between">
                <span className="text-muted-foreground">{t("coach.practiceJourneyPreview.peerSessionsCompleted")}</span>
                <span className="font-semibold">{peerCompleted.length}</span>
              </li>
            </ul>
          )}
          <div className="mt-4">
            <Button asChild variant="outline" size="sm">
              <Link to="/coach/practice-journey">
                {t("coach.practiceJourneyPreview.open")} <ArrowUpRight className="ml-1 h-3 w-3" />
              </Link>
            </Button>
          </div>
        </Card>
      </section>

      {/* Training widgets — each renders nothing when its module isn't enabled */}
      <section className="grid gap-5 lg:grid-cols-2">
        <ThisWeekSkillCard />
        <DailyPromptCard />
      </section>
    </>
  );
}

function RoleIndicator({
  tone,
  label,
  desc,
}: {
  tone: "primary" | "success" | "accent";
  label: string;
  desc: string;
}) {
  const map = {
    primary: "border-primary/20 bg-primary-soft text-primary",
    success: "border-success/20 bg-success/10 text-success",
    accent: "border-accent/30 bg-accent/10 text-accent",
  } as const;
  return (
    <div className={`flex items-center gap-3 rounded-xl border p-3 ${map[tone]}`}>
      <div className="flex-1">
        <p className="text-sm font-semibold">{label}</p>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
    </div>
  );
}

function KindPill({ kind }: { kind: "coaching" | "peer-give" | "peer-receive" }) {
  const { t } = useTranslation("dashboard");
  const map = {
    coaching: { label: t("coach.kindPill.coaching"), className: "bg-primary/10 text-primary" },
    "peer-give": { label: t("coach.kindPill.peerGive"), className: "bg-success/10 text-success" },
    "peer-receive": { label: t("coach.kindPill.peerReceive"), className: "bg-success/15 text-success" },
  } as const;
  const m = map[kind];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest",
        m.className
      )}
    >
      {m.label}
    </span>
  );
}

function NextSessionCard({
  session,
  coach,
}: {
  session: SessionLite | undefined;
  coach: { full_name: string; avatar_url: string | null } | null;
}) {
  const { t } = useTranslation("dashboard");
  if (!session) {
    return (
      <Card className="flex h-full flex-col items-start justify-between gap-4 p-6">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
            {t("coach.nextSession.label")}
          </p>
          <h3 className="mt-2 text-xl font-semibold tracking-tight">{t("coach.nextSession.noneTitle")}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("coach.nextSession.noneBody")}
          </p>
        </div>
        <Button asChild>
          <Link to="/coaches">
            <Search className="mr-1 h-4 w-4" /> {t("coach.nextSession.findCoach")}
          </Link>
        </Button>
      </Card>
    );
  }

  const start = new Date(session.start_time);
  const initials = (coach?.full_name || "?")
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <Card className="relative h-full overflow-hidden bg-gradient-hero p-6 text-primary-foreground">
      <div className="absolute right-0 top-0 h-40 w-40 translate-x-1/4 -translate-y-1/4 rounded-full bg-primary-glow/30 blur-3xl" />
      <div className="relative flex h-full flex-col gap-5">
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest">
          <span className="h-2 w-2 animate-pulse rounded-full bg-success" />
          {t("coach.nextSession.label")}
        </div>
        <div>
          <h3 className="text-2xl font-semibold leading-tight tracking-tight">{session.topic}</h3>
          <div className="mt-3 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl bg-white/15 text-sm font-bold">
              {coach?.avatar_url ? (
                <img src={coach.avatar_url} alt="" className="h-full w-full object-cover" />
              ) : (
                initials
              )}
            </div>
            <div>
              <p className="text-sm font-semibold">{t("coach.nextSession.withPrefix")} {coach?.full_name || t("coach.nextSession.yourCoach")}</p>
              <p className="text-xs text-white/70">
                {format(start, "EEE, MMM d · p")} · {session.duration_minutes} min
              </p>
            </div>
          </div>
        </div>
        <div className="mt-auto flex flex-wrap gap-2">
          {session.meeting_url && session.status === "confirmed" ? (
            <Button asChild variant="secondary" className="font-semibold">
              <Link to={`/sessions/${session.id}`}>
                <Video className="mr-1 h-4 w-4" /> {t("coach.nextSession.enterMeeting")}
              </Link>
            </Button>
          ) : (
            <Badge className="bg-white/15 text-white hover:bg-white/15">
              <Clock className="mr-1 h-3 w-3" />
              {session.status === "pending_coach_approval" ? t("coach.nextSession.awaitingConfirmation") : t("coach.nextSession.confirmedSoon")}
            </Badge>
          )}
          <Button
            asChild
            variant="outline"
            className="border-white/20 bg-white/10 text-white hover:bg-white/20"
          >
            <Link to="/sessions">{t("coach.nextSession.viewDetails")}</Link>
          </Button>
        </div>
      </div>
    </Card>
  );
}
