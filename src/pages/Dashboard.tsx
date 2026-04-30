import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
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
} from "lucide-react";
import { format, isAfter } from "date-fns";
import { toast } from "sonner";
import { useFavorites } from "@/hooks/useFavorites";

interface SessionLite {
  id: string;
  topic: string;
  start_time: string;
  duration_minutes: number;
  status: string;
  meeting_url: string | null;
  coach_id: string;
  coachee_id: string;
  action_items?: any;
}
interface CoachLite {
  id: string;
  title: string | null;
  specialties: string[] | null;
  rating_avg: number;
  profiles: { full_name: string; avatar_url: string | null } | null;
}

export default function Dashboard() {
  const { user, profile, role } = useAuth();
  const firstName = (profile?.full_name || "there").split(" ")[0];

  const greetingByRole: Record<string, string> = {
    coachee: "Find your next coach and keep momentum going.",
    coach: "Review session requests and inspire your coachees today.",
    admin: "Manage approvals, coaches, and platform health.",
  };

  // Coachee data
  const [sessions, setSessions] = useState<SessionLite[]>([]);
  const [coachesById, setCoachesById] = useState<Record<string, { full_name: string; avatar_url: string | null }>>({});
  const [favCoaches, setFavCoaches] = useState<CoachLite[]>([]);
  const [recCoaches, setRecCoaches] = useState<CoachLite[]>([]);
  const [sessionLimit, setSessionLimit] = useState<number>(0);
  const { favorites } = useFavorites();

  useEffect(() => {
    if (!user || role !== "coachee") return;
    (async () => {
      const { data: ses } = await supabase
        .from("sessions")
        .select("id, topic, start_time, duration_minutes, status, meeting_url, coach_id, coachee_id, action_items")
        .eq("coachee_id", user.id)
        .order("start_time", { ascending: false });
      const list = (ses as SessionLite[]) || [];
      setSessions(list);

      const coachIds = Array.from(new Set(list.map((s) => s.coach_id)));
      if (coachIds.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, full_name, avatar_url")
          .in("id", coachIds);
        const map: Record<string, any> = {};
        (profs || []).forEach((p: any) => (map[p.id] = p));
        setCoachesById(map);
      }

      // Session limit (monthly limit acts as the cap shown in the recap)
      const { data: usage } = await supabase.rpc("get_coachee_session_usage", { _coachee_id: user.id });
      if (usage && usage.length > 0) {
        setSessionLimit(usage[0].monthly_limit || 0);
      }

      // Recommended (top-rated active coaches, max 3)
      const { data: recs } = await supabase
        .from("coach_profiles")
        .select("id, title, specialties, rating_avg, profiles!inner(full_name, avatar_url)")
        .eq("approval_status", "active")
        .order("is_featured", { ascending: false })
        .order("rating_avg", { ascending: false })
        .limit(3);
      setRecCoaches((recs as unknown as CoachLite[]) || []);

      // Favorites
      if (favorites.length > 0) {
        const { data: favs } = await supabase
          .from("coach_profiles")
          .select("id, title, specialties, rating_avg, profiles!inner(full_name, avatar_url)")
          .in("id", favorites);
        setFavCoaches((favs as unknown as CoachLite[]) || []);
      } else {
        setFavCoaches([]);
      }
    })();
  }, [user, role, favorites]);

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

  return (
    <div className="space-y-8">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-hero p-8 text-primary-foreground shadow-lg sm:p-12">
        <div className="absolute right-0 top-0 h-64 w-64 translate-x-1/4 -translate-y-1/4 rounded-full bg-primary-glow/30 blur-3xl" />
        <div className="relative max-w-2xl space-y-4">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[10px] font-bold uppercase tracking-widest backdrop-blur-sm">
            <Sparkles className="h-3 w-3" /> {role} workspace
          </div>
          <h1 className="text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
            Welcome back, {firstName}.
          </h1>
          <p className="text-lg text-white/75">{greetingByRole[role || "coachee"]}</p>
          <div className="flex flex-wrap gap-3 pt-2">
            {role === "coachee" && (
              <>
                <Button asChild size="lg" variant="secondary" className="font-semibold">
                  <Link to="/coaches">
                    <Calendar className="mr-1 h-4 w-4" /> Book a session
                  </Link>
                </Button>
                <Button
                  asChild
                  size="lg"
                  variant="outline"
                  className="border-white/20 bg-white/10 text-white hover:bg-white/20"
                >
                  <Link to="/coaches">
                    <Search className="mr-1 h-4 w-4" /> Browse coaches
                  </Link>
                </Button>
              </>
            )}
            <Button
              asChild
              size="lg"
              variant="outline"
              className="border-white/20 bg-white/10 text-white hover:bg-white/20"
            >
              <Link to="/sessions">
                <Calendar className="mr-1 h-4 w-4" /> View sessions
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {role === "coachee" ? (
        <>
          {/* Stats */}
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Session recap"
              value={sessionLimit > 0 ? `${stats.completed} / ${sessionLimit}` : String(stats.completed)}
              hint={sessionLimit > 0 ? `Used of ${sessionLimit} session limit` : "Completed sessions"}
              icon={Calendar}
            />
            <StatCard label="Completed" value={String(stats.completed)} hint="Finished" icon={CheckCircle2} />
            <StatCard label="Upcoming" value={String(stats.upcoming.length)} hint="Booked" icon={CalendarCheck} />
            <StatCard
              label="Hours coached"
              value={stats.hours.toFixed(1)}
              hint="Time invested"
              icon={TrendingUp}
            />
          </section>

          {/* Next session + favorites grid */}
          <section className="grid gap-5 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <NextSessionCard session={nextSession} coach={nextCoach} />
            </div>
            <FavoritesPanel coaches={favCoaches} />
          </section>

          {/* Recent sessions log + Action items */}
          <section className="grid gap-5 lg:grid-cols-2">
            <RecentSessionsLog sessions={sessions} coachesById={coachesById} />
            <ActionItemsPanel sessions={sessions} coachesById={coachesById} />
          </section>

          {/* Recommended coaches */}
          <section>
            <div className="mb-4 flex items-end justify-between">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                  For you
                </p>
                <h2 className="text-xl font-semibold tracking-tight">Recommended coaches</h2>
              </div>
              <Button asChild variant="ghost" size="sm">
                <Link to="/coaches">
                  See all <ArrowUpRight className="ml-1 h-4 w-4" />
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
        </>
      ) : role === "coach" ? (
        <CoachDashboard userId={user!.id} />
      ) : (
        <AdminDashboard />
      )}
    </div>
  );
}

// ============= Coach dashboard =============

interface CoachSession {
  id: string;
  topic: string;
  start_time: string;
  duration_minutes: number;
  status: string;
  coach_notes: string | null;
  meeting_url: string | null;
  coachee_id: string;
}

function CoachDashboard({ userId }: { userId: string }) {
  const [sessions, setSessions] = useState<CoachSession[]>([]);
  const [profilesById, setProfilesById] = useState<
    Record<string, { full_name: string; avatar_url: string | null; email: string }>
  >({});
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);

  const reload = async () => {
    const { data } = await supabase
      .from("sessions")
      .select(
        "id, topic, start_time, duration_minutes, status, coach_notes, meeting_url, coachee_id"
      )
      .eq("coach_id", userId)
      .order("start_time", { ascending: false });
    const list = (data as CoachSession[]) || [];
    setSessions(list);

    const ids = Array.from(new Set(list.map((s) => s.coachee_id)));
    if (ids.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, full_name, avatar_url, email")
        .in("id", ids);
      const map: Record<string, any> = {};
      (profs || []).forEach((p: any) => (map[p.id] = p));
      setProfilesById(map);
    }
    setLoading(false);
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const now = new Date();
  const upcoming = sessions.filter(
    (s) =>
      s.status === "confirmed" && new Date(s.start_time) >= now
  );
  const nextSession = upcoming
    .slice()
    .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())[0];
  const pendingRequests = sessions.filter((s) => s.status === "pending_coach_approval");
  const completed = sessions.filter((s) => s.status === "completed");
  const pendingNotes = completed.filter((s) => !s.coach_notes || !s.coach_notes.trim());

  // Avg rating + total — use coach profile
  const [coachProfile, setCoachProfile] = useState<{
    rating_avg: number;
    sessions_completed: number;
  } | null>(null);
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("coach_profiles")
        .select("rating_avg, sessions_completed")
        .eq("id", userId)
        .maybeSingle();
      if (data) setCoachProfile(data as any);
    })();
  }, [userId]);

  const clientRoster = Array.from(new Set(sessions.map((s) => s.coachee_id))).slice(0, 6);

  const approve = async (s: CoachSession) => {
    setActingId(s.id);
    const { error } = await supabase
      .from("sessions")
      .update({ status: "confirmed", confirmed_at: new Date().toISOString() })
      .eq("id", s.id);
    setActingId(null);
    if (error) return toast.error(error.message);
    toast.success("Session confirmed");
    reload();
  };
  const decline = async (s: CoachSession) => {
    setActingId(s.id);
    const { error } = await supabase
      .from("sessions")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
      .eq("id", s.id);
    setActingId(null);
    if (error) return toast.error(error.message);
    toast.success("Request declined");
    reload();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const nextCoachee = nextSession ? profilesById[nextSession.coachee_id] : null;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Coach Dashboard</h2>
          <p className="text-sm text-muted-foreground">
            Elevate your practice. Manage sessions and coachee growth.
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

      {/* Stats */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Completed sessions"
          value={String(completed.length)}
          hint="All time"
          icon={CheckCircle2}
        />
        <StatCard
          label="Upcoming sessions"
          value={String(upcoming.length)}
          hint="Confirmed"
          icon={CalendarCheck}
        />
        <StatCard
          label="Coachees"
          value={String(new Set(sessions.filter((s) => ["confirmed", "completed"].includes(s.status)).map((s) => s.coachee_id)).size)}
          hint="Active clients"
          icon={Users}
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
                ? {
                    ...nextSession,
                    meeting_url: nextSession.meeting_url,
                    coach_id: userId,
                  } as any
                : undefined
            }
            coach={nextCoachee || null}
          />
        </div>

        {/* Pending notes */}
        <Card className="p-5">
          <p className="mb-3 inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-warning">
            <Clock className="h-3.5 w-3.5" /> Pending notes
          </p>
          {pendingNotes.length === 0 ? (
            <p className="text-sm text-muted-foreground">All caught up — no notes pending.</p>
          ) : (
            <ul className="space-y-2">
              {pendingNotes.slice(0, 4).map((s) => {
                const p = profilesById[s.coachee_id];
                return (
                  <li key={s.id}>
                    <Link
                      to={`/sessions/${s.id}`}
                      className="block rounded-lg border border-warning/30 bg-warning/5 p-3 transition-colors hover:bg-warning/10"
                    >
                      <p className="text-sm font-semibold">{p?.full_name || "Coachee"}</p>
                      <p className="text-xs text-muted-foreground">{s.topic}</p>
                      <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-warning">
                        Write notes <ArrowUpRight className="h-3 w-3" />
                      </span>
                    </Link>
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

      {/* Client roster */}
      <section>
        <Card className="p-5">
          <p className="mb-4 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
            Client roster
          </p>
          {clientRoster.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              You don't have any active coachees yet.
            </p>
          ) : (
            <ul className="divide-y">
              {clientRoster.map((id) => {
                const p = profilesById[id];
                const sessCount = sessions.filter((s) => s.coachee_id === id).length;
                const initials = (p?.full_name || "?")
                  .split(" ")
                  .map((n) => n[0])
                  .join("")
                  .slice(0, 2)
                  .toUpperCase();
                return (
                  <li key={id} className="flex items-center justify-between py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-soft text-xs font-bold text-primary">
                        {initials}
                      </div>
                      <div>
                        <p className="text-sm font-semibold">{p?.full_name || "Coachee"}</p>
                        <p className="text-xs text-muted-foreground">
                          {sessCount} session{sessCount > 1 ? "s" : ""}
                        </p>
                      </div>
                    </div>
                    <Badge variant="secondary" className="rounded-full">
                      Active
                    </Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </section>
    </>
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
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
            {label}
          </p>
          <p className="mt-2 text-3xl font-semibold tracking-tight">{value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-soft text-primary">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </Card>
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
    <Link to={`/coaches/${coach.id}`} className="group block">
      <Card className="h-full p-5 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md">
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-xl bg-primary-soft text-sm font-bold text-primary">
            {coach.profiles?.avatar_url ? (
              <img src={coach.profiles.avatar_url} alt="" className="h-full w-full object-cover" />
            ) : (
              initials
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{coach.profiles?.full_name}</p>
            <p className="truncate text-xs text-muted-foreground">{coach.title || "Coach"}</p>
          </div>
          <span className="inline-flex items-center gap-1 text-xs font-semibold">
            <Star className="h-3 w-3 fill-warning text-warning" />
            {Number(coach.rating_avg).toFixed(1)}
          </span>
        </div>
        {coach.specialties && coach.specialties.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {coach.specialties.slice(0, 3).map((s) => (
              <Badge key={s} variant="secondary" className="rounded-full text-[10px]">
                {s}
              </Badge>
            ))}
          </div>
        )}
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
    arr.forEach((it: any) => {
      const text = typeof it === "string" ? it : it?.text || "";
      const done = typeof it === "string" ? false : !!it?.done;
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
  const [stats, setStats] = useState({
    totalCoachees: 0,
    bookedSessions: 0,
    completedSessions: 0,
    cancelledSessions: 0,
    totalSessions: 0,
    pendingLinkSessions: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [coacheeRolesRes, sessionsRes, pendingLinkRes] = await Promise.all([
        supabase
          .from("user_roles")
          .select("user_id", { count: "exact", head: true })
          .eq("role", "coachee"),
        supabase.from("sessions").select("id, status, meeting_url"),
        supabase
          .from("sessions")
          .select("id", { count: "exact", head: true })
          .in("status", ["confirmed", "pending_coach_approval"])
          .or("meeting_url.is.null,meeting_url.eq."),
      ]);

      const all = sessionsRes.data || [];
      const booked = all.filter((s) =>
        ["pending_coach_approval", "confirmed", "completed"].includes(s.status)
      ).length;
      const completed = all.filter((s) => s.status === "completed").length;
      const cancelled = all.filter((s) => s.status === "cancelled").length;

      setStats({
        totalCoachees: coacheeRolesRes.count || 0,
        bookedSessions: booked,
        completedSessions: completed,
        cancelledSessions: cancelled,
        totalSessions: all.length,
        pendingLinkSessions: pendingLinkRes.count || 0,
      });
      setLoading(false);
    })();
  }, []);

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

      <section className="grid gap-4 sm:grid-cols-1">
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
            <Button asChild>
              <Link to="/admin/sessions">Set meeting links</Link>
            </Button>
          </div>
        </Card>
      </section>
    </>
  );
}
