import { useMemo } from "react";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/card";
import { HeroPanel, PageHeader } from "@/components/ui/page-header";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link } from "react-router-dom";
import {
  Calendar,
  Search,
  Sparkles,
  TrendingUp,
  Clock,
  CheckCircle2,
  Video,
  ArrowUpRight,
  Heart,
  Star,
  CalendarCheck,
  Loader2,
  Users,
  UserCheck,
  XCircle,
  ListChecks,
  History,
  MapPin,
} from "lucide-react";
import { format, isAfter, differenceInCalendarDays, isToday } from "date-fns";
import { useFavorites } from "@/hooks/useFavorites";
import { cn } from "@/lib/utils";
import { useCoacheeDashboardData, SessionLite, CoachLite } from "@/hooks/dashboard/useCoacheeDashboardData";
import { ProgressRing } from "@/components/ui/proto";
import { Json } from "@/integrations/supabase/types";
import { useCoachDashboardData, CoachSession } from "@/hooks/dashboard/useCoachDashboardData";
import { useAdminDashboardStats } from "@/hooks/dashboard/useAdminDashboardStats";

export default function Dashboard() {
  const { user, profile, role } = useAuth();
  const firstName = (profile?.full_name || "there").split(" ")[0];

  const greetingByRole: Record<string, string> = {
    coachee: "Find your next coach and keep momentum going.",
    coach: "Review session requests and inspire your coachees today.",
    admin: "Manage approvals, coaches, and platform health.",
  };

  // Coachee data
  const { favorites } = useFavorites();
  const isCoachee = role === "coachee";
  const { sessions, coachesById, favCoaches, recCoaches, sessionLimit } = useCoacheeDashboardData(
    user?.id,
    isCoachee,
    favorites
  );

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
  const timeGreeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  if (role !== "coachee") {
    return (
      <div className="space-y-8">
        <HeroPanel>
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[9.5px] font-bold uppercase tracking-[0.2em] backdrop-blur-sm">
              <Sparkles className="h-3 w-3" /> {role} workspace
            </div>
            <h1 className="font-display mt-5 text-[clamp(2.2rem,4.6vw,3.4rem)] leading-[1.05]">
              Welcome back,{" "}
              <em className="italic text-primary-glow">{firstName}</em>.
            </h1>
            <p className="mt-3 text-base text-white/70">{greetingByRole[role || "coachee"]}</p>
            <div className="flex flex-wrap gap-3 pt-6">
              <Button
                asChild
                size="lg"
                variant="outline"
                className="rounded-xl border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
              >
                <Link to="/sessions">
                  <Calendar className="mr-1 h-4 w-4" /> View sessions
                </Link>
              </Button>
            </div>
          </div>
        </HeroPanel>
        {role === "coach" ? <CoachDashboard userId={user!.id} /> : <AdminDashboard />}
      </div>
    );
  }

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
            ? `You have ${stats.upcoming.length} upcoming session${stats.upcoming.length === 1 ? "" : "s"}. Keep the momentum going.`
            : "Browse our curated coaches and book your next session to keep momentum going."}
        </p>
      </div>

      {/* Next session hero */}
      <NextSessionHero session={nextSession} coach={nextCoach} programmePct={programmePct} />

      {/* Stats */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Sessions done"
          value={sessionLimit > 0 ? `${stats.completed} / ${sessionLimit}` : String(stats.completed)}
          hint={sessionLimit > 0 ? `of ${sessionLimit} in programme` : "Completed sessions"}
          icon={Calendar}
        />
        <StatCard
          label="Hours coached"
          value={stats.hours.toFixed(1)}
          hint="Time invested"
          icon={TrendingUp}
        />
        <StatCard
          label="Actions open"
          value={String(
            sessions.reduce((acc, s) => {
              const arr = Array.isArray(s.action_items) ? s.action_items : [];
              return acc + arr.filter((it: Json) => (typeof it === "string" ? true : !(it as { done?: boolean })?.done)).length;
            }, 0)
          )}
          hint="Across sessions"
          icon={ListChecks}
        />
        <StatCard label="Upcoming" value={String(stats.upcoming.length)} hint="Booked" icon={CalendarCheck} />
      </section>

      {/* Recent sessions log + Action items */}
      <section className="grid gap-5 lg:grid-cols-2">
        <RecentSessionsLog sessions={sessions} coachesById={coachesById} />
        <ActionItemsPanel sessions={sessions} coachesById={coachesById} />
      </section>

      {/* Curated for you */}
      <section>
        <div className="mb-4 flex items-end justify-between">
          <div>
            <p className="eyebrow mb-1">Curated for you</p>
            <h2 className="font-display text-xl tracking-tight text-foreground">
              Coaches matched to your goals
            </h2>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link to="/coaches">
              Browse all <ArrowUpRight className="ml-1 h-4 w-4" />
            </Link>
          </Button>
        </div>
        {recCoaches.length === 0 ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            No coaches available yet.
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

// ============= Coach dashboard =============

function CoachDashboard({ userId }: { userId: string }) {
  const {
    sessions,
    peerSessions,
    profilesById,
    loading,
    actingId,
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
        counterpart: profilesById[s.coachee_id]?.full_name || "Coachee",
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
          counterpart: profilesById[counterpartId]?.full_name || "Peer",
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
            Coach <em className="not-italic text-primary">workspace</em>
          </h2>
          <p className="text-sm text-muted-foreground">
            Confirm sessions, support clients, and grow through peer coaching.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link to="/coach/profile">Edit profile</Link>
          </Button>
          <Button asChild className="shadow-glow">
            <Link to="/coach/availability">Set availability</Link>
          </Button>
        </div>
      </div>

      {/* Role indicators */}
      <section className="grid gap-3 sm:grid-cols-3">
        <RoleIndicator
          tone="primary"
          label="Coaching"
          desc={`${activeClients} active client${activeClients === 1 ? "" : "s"}`}
        />
        <RoleIndicator
          tone="success"
          label="Peer coaching"
          desc={peerOptIn ? "Available for peers" : "Not opted in"}
        />
        <RoleIndicator
          tone="accent"
          label="Coachee"
          desc="Open to being coached"
        />
      </section>

      {/* Stats */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Sessions completed"
          value={String(completed.length)}
          hint="As coach"
          icon={CheckCircle2}
        />
        <StatCard
          label="Peer sessions"
          value={String(peerCompleted.length)}
          hint="Completed peer"
          icon={Users}
        />
        <StatCard
          label="Upcoming"
          value={String(
            upcoming.length +
              peerSessions.filter((s) => s.status === "confirmed" && new Date(s.start_time) >= now)
                .length
          )}
          hint="Confirmed"
          icon={CalendarCheck}
        />
        <StatCard
          label="Avg. rating"
          value={(coachProfile?.rating_avg ?? 5).toFixed(1)}
          hint="From coachees"
          icon={Star}
        />
      </section>

      <section className="grid gap-5 lg:grid-cols-3">
        {/* Next session */}
        <div className="lg:col-span-2">
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
            <Clock className="h-3.5 w-3.5" /> Peer requests
          </p>
          {peerPending.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {peerOptIn
                ? "No peer requests right now."
                : "Opt in to peer coaching from My availability."}
            </p>
          ) : (
            <ul className="space-y-2">
              {peerPending.slice(0, 4).map((s) => {
                const p = profilesById[s.peer_coachee_id];
                return (
                  <li
                    key={s.id}
                    className="rounded-lg border border-success/30 bg-success/5 p-3"
                  >
                    <p className="text-sm font-semibold">{p?.full_name || "Peer"}</p>
                    <p className="text-xs text-muted-foreground">{s.topic}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {format(new Date(s.start_time), "MMM d · p")}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </section>

      {/* Booking requests */}
      <section>
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <p className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
              <Clock className="h-3.5 w-3.5" /> Booking requests
            </p>
            {pendingRequests.length > 0 && (
              <Badge className="bg-warning/15 text-warning hover:bg-warning/15">
                {pendingRequests.length} new
              </Badge>
            )}
          </div>
          {pendingRequests.length === 0 ? (
            <p className="text-sm text-muted-foreground">No pending requests right now.</p>
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
                        <p className="truncate font-semibold">{p?.full_name || "Coachee"}</p>
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
                        <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => decline(s)}
                        disabled={actingId === s.id}
                      >
                        Decline
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
            Upcoming sessions
          </p>
          {mixedUpcoming.length === 0 ? (
            <p className="text-sm text-muted-foreground">No confirmed sessions ahead.</p>
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
                      with {s.counterpart} · {format(new Date(s.start_time), "MMM d, yyyy · p")}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-5">
          <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
            Practice journey preview
          </p>
          {peerCompleted.length === 0 && completed.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Your peer-coaching and coached sessions will appear here.
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              <li className="flex justify-between">
                <span className="text-muted-foreground">Sessions delivered</span>
                <span className="font-semibold">{completed.length}</span>
              </li>
              <li className="flex justify-between">
                <span className="text-muted-foreground">Peer sessions completed</span>
                <span className="font-semibold">{peerCompleted.length}</span>
              </li>
            </ul>
          )}
          <div className="mt-4">
            <Button asChild variant="outline" size="sm">
              <Link to="/coach/practice-journey">
                Open practice journey <ArrowUpRight className="ml-1 h-3 w-3" />
              </Link>
            </Button>
          </div>
        </Card>
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
  const map = {
    coaching: { label: "Coaching", className: "bg-primary/10 text-primary" },
    "peer-give": { label: "Peer · give", className: "bg-success/10 text-success" },
    "peer-receive": { label: "Peer · receive", className: "bg-success/15 text-success" },
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

function StatCard({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: string;
  hint: string;
  icon: React.ElementType;
}) {
  return (
    <div className="surface-card hover-lift p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[9.5px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
          {label}
        </p>
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[9px] bg-primary-soft text-primary">
          <Icon className="h-3.5 w-3.5" />
        </span>
      </div>
      <p className="font-display mt-3 text-[2.6rem] font-normal leading-none tracking-tight">{value}</p>
      <p className="mt-2.5 text-xs text-muted-foreground">{hint}</p>
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
  if (!session) {
    return (
      <HeroPanel>
        <div className="flex flex-col items-start gap-4">
          <p className="text-[11px] font-bold uppercase tracking-widest text-white/70">
            Next session
          </p>
          <h3 className="font-display text-2xl leading-tight sm:text-3xl">No upcoming sessions</h3>
          <p className="max-w-md text-sm text-white/70">
            Browse our curated coaches and book your first 30, 45, or 60-minute session.
          </p>
          <Button asChild variant="secondary" className="font-semibold">
            <Link to="/coaches">
              <Search className="mr-1 h-4 w-4" /> Find a coach
            </Link>
          </Button>
        </div>
      </HeroPanel>
    );
  }

  const start = new Date(session.start_time);
  const days = differenceInCalendarDays(start, new Date());
  const inLabel = isToday(start) ? "Today" : days === 1 ? "In 1 day" : days > 1 ? `In ${days} days` : "Soon";
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
            Next session · {inLabel}
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
              <p className="text-sm font-semibold">{coach?.full_name || "Your coach"}</p>
              <p className="text-xs text-white/70">
                {format(start, "EEE d MMM")} · {format(start, "HH:mm")} · {session.duration_minutes} min
              </p>
            </div>
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            {session.meeting_url && session.status === "confirmed" ? (
              <Button asChild variant="secondary" className="font-semibold">
                <a href={session.meeting_url} target="_blank" rel="noreferrer">
                  <Video className="mr-1 h-4 w-4" /> Join & prepare
                </a>
              </Button>
            ) : (
              <Button asChild variant="secondary" className="font-semibold">
                <Link to={`/sessions/${session.id}`}>
                  <Video className="mr-1 h-4 w-4" /> Join & prepare
                </Link>
              </Button>
            )}
            <Button
              asChild
              variant="outline"
              className="border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
            >
              <Link to="/sessions">All sessions</Link>
            </Button>
          </div>
        </div>
        <div className="shrink-0 self-center">
          <ProgressRing
            value={programmePct}
            tone="primary"
            invert
            label={<span className="text-[9.5px] tracking-[0.2em]">PROGRAMME</span>}
            size={140}
          />
        </div>
      </div>
    </HeroPanel>
  );
}

function NextSessionCard({
  session,
  coach,
}: {
  session: SessionLite | undefined;
  coach: { full_name: string; avatar_url: string | null } | null;
}) {
  if (!session) {
    return (
      <Card className="flex h-full flex-col items-start justify-between gap-4 p-6">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
            Next session
          </p>
          <h3 className="mt-2 text-xl font-semibold tracking-tight">No upcoming sessions</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Browse our curated coaches and book your first 30, 45, or 60-minute session.
          </p>
        </div>
        <Button asChild>
          <Link to="/coaches">
            <Search className="mr-1 h-4 w-4" /> Find a coach
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
          Next session
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
              <p className="text-sm font-semibold">with {coach?.full_name || "your coach"}</p>
              <p className="text-xs text-white/70">
                {format(start, "EEE, MMM d · p")} · {session.duration_minutes} min
              </p>
            </div>
          </div>
        </div>
        <div className="mt-auto flex flex-wrap gap-2">
          {session.meeting_url && session.status === "confirmed" ? (
            <Button asChild variant="secondary" className="font-semibold">
              <a href={session.meeting_url} target="_blank" rel="noreferrer">
                <Video className="mr-1 h-4 w-4" /> Enter meeting
              </a>
            </Button>
          ) : (
            <Badge className="bg-white/15 text-white hover:bg-white/15">
              <Clock className="mr-1 h-3 w-3" />
              {session.status === "pending_coach_approval" ? "Awaiting confirmation" : "Confirmed soon"}
            </Badge>
          )}
          <Button
            asChild
            variant="outline"
            className="border-white/20 bg-white/10 text-white hover:bg-white/20"
          >
            <Link to="/sessions">View details</Link>
          </Button>
        </div>
      </div>
    </Card>
  );
}

function FavoritesPanel({ coaches }: { coaches: CoachLite[] }) {
  return (
    <Card className="flex h-full flex-col p-5">
      <div className="mb-3 flex items-center gap-2">
        <Heart className="h-4 w-4 text-primary" />
        <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
          Favorite coaches
        </p>
      </div>
      {coaches.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
          <p>Tap the heart on any coach to save them here.</p>
          <Button asChild variant="link" size="sm" className="h-auto p-0">
            <Link to="/coaches">Browse coaches</Link>
          </Button>
        </div>
      ) : (
        <ul className="space-y-2">
          {coaches.slice(0, 4).map((c) => {
            const initials = (c.profiles?.full_name || "?")
              .split(" ")
              .map((n) => n[0])
              .join("")
              .slice(0, 2)
              .toUpperCase();
            return (
              <li key={c.id}>
                <Link
                  to={`/coaches/${c.id}`}
                  className="flex items-center gap-3 rounded-xl p-2 transition-colors hover:bg-secondary"
                >
                  <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-lg bg-primary-soft text-xs font-bold text-primary">
                    {c.profiles?.avatar_url ? (
                      <img src={c.profiles.avatar_url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      initials
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{c.profiles?.full_name}</p>
                    <p className="truncate text-xs text-muted-foreground">{c.title || "Coach"}</p>
                  </div>
                  <span className="inline-flex items-center gap-1 text-xs font-semibold">
                    <Star className="h-3 w-3 fill-warning text-warning" />
                    {Number(c.rating_avg).toFixed(1)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function RecommendedCoachCard({ coach }: { coach: CoachLite }) {
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
            <p className="truncate text-xs text-muted-foreground">{coach.title || "Coach"}</p>
          </div>
        </div>

        <p className="mt-3 line-clamp-2 flex-1 text-sm italic text-muted-foreground">
          {coach.profiles?.bio ? `"${coach.profiles.bio}"` : "Profile available — open to learn more."}
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
          <span className="text-sm font-semibold text-primary">View profile</span>
        </div>
      </Card>
    </Link>
  );
}

// ============= Recent sessions log (coachee) =============
function RecentSessionsLog({
  sessions,
  coachesById,
}: {
  sessions: SessionLite[];
  coachesById: Record<string, { full_name: string; avatar_url: string | null }>;
}) {
  const recent = sessions.slice(0, 6);
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-2">
        <History className="h-4 w-4 text-primary" />
        <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
          Recent session log
        </p>
      </div>
      {recent.length === 0 ? (
        <p className="text-sm text-muted-foreground">No sessions yet.</p>
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
                      with {coach?.full_name || "coach"} ·{" "}
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

// ============= Action items panel (coachee) =============
function ActionItemsPanel({
  sessions,
  coachesById,
}: {
  sessions: SessionLite[];
  coachesById: Record<string, { full_name: string; avatar_url: string | null }>;
}) {
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
          coach: coachesById[s.coach_id]?.full_name || "coach",
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
          Action items
        </p>
      </div>
      {open.length === 0 ? (
        <p className="text-sm text-muted-foreground">No open action items. 🎉</p>
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

// ============= Admin dashboard =============
function AdminDashboard() {
  const { stats, loading } = useAdminDashboardStats();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const pct = (n: number) =>
    stats.totalSessions > 0 ? Math.round((n / stats.totalSessions) * 100) : 0;

  return (
    <>
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total users"
          value={String(stats.totalCoachees)}
          hint="Coachee accounts"
          icon={Users}
        />
        <StatCard
          label="Booked sessions"
          value={String(stats.bookedSessions)}
          hint="Pending + confirmed + done"
          icon={CalendarCheck}
        />
        <StatCard
          label="Completed sessions"
          value={`${stats.completedSessions} (${pct(stats.completedSessions)}%)`}
          hint="Of all sessions"
          icon={CheckCircle2}
        />
        <StatCard
          label="Cancelled sessions"
          value={`${stats.cancelledSessions} (${pct(stats.cancelledSessions)}%)`}
          hint="Of all sessions"
          icon={XCircle}
        />
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <Card className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                Pending sessions
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {stats.pendingLinkSessions === 0
                  ? "All upcoming sessions have a meeting link."
                  : `${stats.pendingLinkSessions} session${stats.pendingLinkSessions === 1 ? "" : "s"} still need a meeting link.`}
              </p>
            </div>
            <Button asChild size="sm">
              <Link to="/admin/sessions">Set links</Link>
            </Button>
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                Pending coaches
              </p>
              <p className="mt-2 text-2xl font-semibold">{stats.pendingCoaches}</p>
              <p className="text-sm text-muted-foreground">
                {stats.pendingCoaches === 0 ? "No coaches awaiting approval." : "Awaiting your review."}
              </p>
            </div>
            <Button asChild size="sm" variant="outline">
              <Link to="/admin/registrations">Review</Link>
            </Button>
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                Pending coachees
              </p>
              <p className="mt-2 text-2xl font-semibold">{stats.pendingCoachees}</p>
              <p className="text-sm text-muted-foreground">
                {stats.pendingCoachees === 0 ? "No coachees awaiting approval." : "Awaiting your review."}
              </p>
            </div>
            <Button asChild size="sm" variant="outline">
              <Link to="/admin/registrations">Review</Link>
            </Button>
          </div>
        </Card>
      </section>
    </>
  );
}
