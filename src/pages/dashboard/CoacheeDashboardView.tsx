import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/card";
import { HeroPanel, StatCard } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Calendar,
  Search,
  TrendingUp,
  Video,
  ArrowUpRight,
  Star,
  CalendarCheck,
  ListChecks,
  History,
  MapPin,
} from "lucide-react";
import { format, isAfter, differenceInCalendarDays, isToday } from "date-fns";
import { useFavorites } from "@/hooks/useFavorites";
import { useCoacheeDashboardData, SessionLite, CoachLite } from "@/hooks/dashboard/useCoacheeDashboardData";
import { ProgressRing } from "@/components/ui/proto";
import { Json } from "@/integrations/supabase/types";
import { ThisWeekSkillCard } from "@/components/training/ThisWeekSkillCard";
import { DailyPromptCard } from "@/components/training/DailyPromptCard";

export function CoacheeDashboardView() {
  const { t } = useTranslation("dashboard");
  const { user, profile } = useAuth();
  const firstName = (profile?.full_name || "there").split(" ")[0];
  const { favorites } = useFavorites();
  const { sessions, coachesById, recCoaches, sessionLimit } = useCoacheeDashboardData(user?.id, true, favorites);

  const now = new Date();
  const stats = useMemo(() => {
    const total = sessions.length;
    const completed = sessions.filter((s) => s.status === "completed").length;
    const upcoming = sessions.filter(
      (s) => s.status !== "cancelled" && s.status !== "completed" && isAfter(new Date(s.start_time), now)
    );
    const hours = sessions
      .filter((s) => s.status === "completed")
      .reduce((acc, s) => acc + s.duration_minutes / 60, 0);
    return { total, completed, upcoming, hours };
  }, [sessions]);

  const nextSession = stats.upcoming?.slice().sort(
    (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
  )[0];
  const nextCoach = nextSession ? coachesById[nextSession.coach_id] : null;

  const hour = now.getHours();
  const timeGreeting = hour < 12 ? t("coachee.greeting.morning") : hour < 18 ? t("coachee.greeting.afternoon") : t("coachee.greeting.evening");

  const programmePct = sessionLimit > 0 ? Math.round((stats.completed / sessionLimit) * 100) : 0;

  return (
    <div className="space-y-8">
      {/* Greeting */}
      <div className="animate-rise">
        <p className="eyebrow mb-2.5">{format(now, "EEEE, d MMMM").toUpperCase()}</p>
        <h1 className="font-display text-[clamp(2.1rem,4.4vw,3.1rem)] leading-[1.05] text-foreground">
          {timeGreeting}, <em className="italic text-primary">{firstName}</em>.
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
          {nextSession
            ? t("coachee.upcomingLine", { count: stats.upcoming.length })
            : t("coachee.noUpcomingLine")}
        </p>
      </div>

      {/* Next session hero */}
      <div data-onboarding="dashboard-next-session">
        <NextSessionHero session={nextSession} coach={nextCoach} programmePct={programmePct} />
      </div>

      {/* Stats */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={t("coachee.stats.sessionsDone")}
          value={sessionLimit > 0 ? `${stats.completed} / ${sessionLimit}` : String(stats.completed)}
          hint={sessionLimit > 0 ? t("coachee.stats.sessionsDoneHintProgramme", { limit: sessionLimit }) : t("coachee.stats.sessionsDoneHintPlain")}
          icon={Calendar}
        />
        <StatCard
          label={t("coachee.stats.hoursCoached")}
          value={stats.hours.toFixed(1)}
          hint={t("coachee.stats.hoursCoachedHint")}
          icon={TrendingUp}
        />
        <StatCard
          label={t("coachee.stats.actionsOpen")}
          value={String(
            sessions.reduce((acc, s) => {
              const arr = Array.isArray(s.action_items) ? s.action_items : [];
              return acc + arr.filter((it: Json) => (typeof it === "string" ? true : !(it as { done?: boolean })?.done)).length;
            }, 0)
          )}
          hint={t("coachee.stats.actionsOpenHint")}
          icon={ListChecks}
        />
        <StatCard label={t("coachee.stats.upcoming")} value={String(stats.upcoming.length)} hint={t("coachee.stats.upcomingHint")} icon={CalendarCheck} />
      </section>

      {/* Recent sessions log + Action items + this week's skill card */}
      <section className="grid gap-5 lg:grid-cols-2" data-onboarding="dashboard-session-log">
        <RecentSessionsLog sessions={sessions} coachesById={coachesById} />
        <ActionItemsPanel sessions={sessions} coachesById={coachesById} />
        <ThisWeekSkillCard />
        <DailyPromptCard />
      </section>

      {/* Curated for you */}
      <section>
        <div className="mb-4 flex items-end justify-between">
          <div>
            <p className="eyebrow mb-1">{t("coachee.curatedForYou.eyebrow")}</p>
            <h2 className="font-display text-xl tracking-tight text-foreground">
              {t("coachee.curatedForYou.title")}
            </h2>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link to="/coaches">
              {t("coachee.curatedForYou.browseAll")} <ArrowUpRight className="ml-1 h-4 w-4" />
            </Link>
          </Button>
        </div>
        {recCoaches.length === 0 ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            {stats.total === 0
              ? t("coachee.curatedForYou.noneAvailableNewCoachee")
              : t("coachee.curatedForYou.noneAvailableExisting")}
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {recCoaches.map((c) => (
              <RecommendedCoachCard key={c.id} coach={c} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function NextSessionHero({
  session,
  coach,
  programmePct,
}: {
  session: SessionLite | undefined;
  coach: { full_name: string; avatar_url: string | null } | null;
  programmePct: number;
}) {
  const { t } = useTranslation("dashboard");
  if (!session) {
    return (
      <HeroPanel>
        <div className="flex flex-col items-start gap-4">
          <p className="text-[11px] font-bold uppercase tracking-widest text-white/70">
            {t("coachee.nextSession.label")}
          </p>
          <h3 className="font-display text-2xl leading-tight sm:text-3xl">{t("coachee.nextSession.noneTitle")}</h3>
          <p className="max-w-md text-sm text-white/70">
            {t("coachee.nextSession.noneBody")}
          </p>
          <Button asChild variant="secondary" className="font-semibold">
            <Link to="/coaches">
              <Search className="mr-1 h-4 w-4" /> {t("coachee.nextSession.findCoach")}
            </Link>
          </Button>
        </div>
      </HeroPanel>
    );
  }

  const start = new Date(session.start_time);
  const days = differenceInCalendarDays(start, new Date());
  const inLabel = isToday(start) ? t("coachee.nextSession.today") : days === 1 ? t("coachee.nextSession.inOneDay") : days > 1 ? t("coachee.nextSession.inDays", { count: days }) : t("coachee.nextSession.soon");
  const initials = (coach?.full_name || "?")
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <HeroPanel>
      <div className="flex flex-col gap-8 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 max-w-xl">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[9.5px] font-bold uppercase tracking-[0.2em] backdrop-blur-sm">
            <span className="h-2 w-2 animate-pulse rounded-full bg-success" />
            {t("coachee.nextSession.label")} · {inLabel}
          </span>
          <h3 className="font-display mt-5 text-[clamp(1.6rem,3.4vw,2.4rem)] leading-[1.1]">
            {session.topic}
          </h3>
          <div className="mt-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl bg-white/15 text-sm font-bold">
              {coach?.avatar_url ? (
                <img src={coach.avatar_url} alt="" className="h-full w-full object-cover" />
              ) : (
                initials
              )}
            </div>
            <div>
              <p className="text-sm font-semibold">{coach?.full_name || t("coachee.nextSession.yourCoach")}</p>
              <p className="text-xs text-white/70">
                {format(start, "EEE d MMM")} · {format(start, "HH:mm")} · {session.duration_minutes} min
              </p>
            </div>
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button asChild variant="secondary" className="font-semibold">
              <Link to={`/sessions/${session.id}`}>
                <Video className="mr-1 h-4 w-4" /> {t("coachee.nextSession.joinAndPrepare")}
              </Link>
            </Button>
            <Button
              asChild
              variant="outline"
              className="border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
            >
              <Link to="/sessions">{t("coachee.nextSession.allSessions")}</Link>
            </Button>
          </div>
        </div>
        <div className="shrink-0 self-center">
          <ProgressRing
            value={programmePct}
            tone="primary"
            invert
            label={<span className="text-[9.5px] tracking-[0.2em]">{t("coachee.nextSession.programmeLabel")}</span>}
            size={140}
          />
        </div>
      </div>
    </HeroPanel>
  );
}

function RecommendedCoachCard({ coach }: { coach: CoachLite }) {
  const { t } = useTranslation("dashboard");
  const initials = (coach.profiles?.full_name || "?")
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <Link to={`/coaches/${coach.id}`} className="group block h-full">
      <Card className="flex h-full flex-col p-6 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md">
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-primary-soft text-sm font-bold text-primary">
            {coach.profiles?.avatar_url ? (
              <img src={coach.profiles.avatar_url} alt="" className="h-full w-full object-cover" />
            ) : (
              initials
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate font-semibold">{coach.profiles?.full_name}</p>
              <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-warning">
                <Star className="h-3 w-3 fill-warning" />
                {Number(coach.rating_avg).toFixed(1)}
              </span>
            </div>
            <p className="truncate text-xs text-muted-foreground">{coach.title || t("coachee.coachCard.defaultTitle")}</p>
          </div>
        </div>

        <p className="mt-3 line-clamp-2 flex-1 text-sm italic text-muted-foreground">
          {coach.profiles?.bio ? `"${coach.profiles.bio}"` : t("coachee.coachCard.noBio")}
        </p>

        {coach.specialties && coach.specialties.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {coach.specialties.slice(0, 2).map((s) => (
              <Badge key={s} variant="secondary" className="rounded-full text-[10px] uppercase tracking-wider">
                {s}
              </Badge>
            ))}
          </div>
        )}

        <div className="mt-5 flex items-center justify-between border-t border-border pt-4 text-sm">
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <MapPin className="h-3.5 w-3.5" />
            {coach.years_experience ?? 0} yrs{coach.country_based ? ` · ${coach.country_based}` : ""}
          </span>
          <span className="text-sm font-semibold text-primary">{t("coachee.coachCard.viewProfile")}</span>
        </div>
      </Card>
    </Link>
  );
}

function RecentSessionsLog({
  sessions,
  coachesById,
}: {
  sessions: SessionLite[];
  coachesById: Record<string, { full_name: string; avatar_url: string | null }>;
}) {
  const { t } = useTranslation("dashboard");
  const recent = sessions.slice(0, 6);
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-2">
        <History className="h-4 w-4 text-primary" />
        <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
          {t("coachee.recentLog.title")}
        </p>
      </div>
      {recent.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("coachee.recentLog.empty")}</p>
      ) : (
        <ul className="divide-y">
          {recent.map((s) => {
            const coach = coachesById[s.coach_id];
            return (
              <li key={s.id}>
                <Link
                  to={`/sessions/${s.id}`}
                  className="flex items-center justify-between gap-3 py-3 transition-colors hover:bg-muted/40"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{s.topic}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {t("coachee.recentLog.withCoach", { name: coach?.full_name || t("coachee.recentLog.defaultCoach") })} ·{" "}
                      {format(new Date(s.start_time), "MMM d, yyyy")}
                    </p>
                  </div>
                  <Badge variant="secondary" className="shrink-0 rounded-full text-[10px]">
                    {s.status.replace(/_/g, " ")}
                  </Badge>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function ActionItemsPanel({
  sessions,
  coachesById,
}: {
  sessions: SessionLite[];
  coachesById: Record<string, { full_name: string; avatar_url: string | null }>;
}) {
  const { t } = useTranslation("dashboard");
  const items: { text: string; done: boolean; sessionId: string; topic: string; date: string; coach: string }[] = [];
  sessions.forEach((s) => {
    const arr = Array.isArray(s.action_items) ? s.action_items : [];
    arr.forEach((it: Json) => {
      const text = typeof it === "string" ? it : (it as { text?: string })?.text || "";
      const done = typeof it === "string" ? false : !!(it as { done?: boolean })?.done;
      if (text) {
        items.push({
          text,
          done,
          sessionId: s.id,
          topic: s.topic,
          date: s.start_time,
          coach: coachesById[s.coach_id]?.full_name || t("coachee.actionItems.defaultCoach"),
        });
      }
    });
  });

  const open = items.filter((i) => !i.done).slice(0, 8);

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-2">
        <ListChecks className="h-4 w-4 text-primary" />
        <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
          {t("coachee.actionItems.title")}
        </p>
      </div>
      {open.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("coachee.actionItems.empty")}</p>
      ) : (
        <ul className="space-y-2">
          {open.map((it, idx) => (
            <li key={idx}>
              <Link
                to={`/sessions/${it.sessionId}`}
                className="block rounded-lg border p-3 transition-colors hover:bg-muted/40"
              >
                <p className="text-sm font-medium">{it.text}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {it.coach} · {format(new Date(it.date), "MMM d, yyyy")}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
