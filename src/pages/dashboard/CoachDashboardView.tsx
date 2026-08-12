import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { StatCard } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Clock, CheckCircle2, Users, CalendarCheck, Star, Video, ArrowUpRight, Search } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useCoachDashboardData } from "@/hooks/dashboard/useCoachDashboardData";
import type { SessionLite } from "@/hooks/dashboard/useCoacheeDashboardData";

export function CoachDashboardView({ userId }: { userId: string }) {
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
                        <p className="text-sm font-semibold">{p?.full_name || "Peer"}</p>
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
                    Review in sessions <ArrowUpRight className="ml-1 h-3 w-3" />
                  </Link>
                </Button>
              </div>
            </>
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
              <Link to={`/sessions/${session.id}`}>
                <Video className="mr-1 h-4 w-4" /> Enter meeting
              </Link>
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
