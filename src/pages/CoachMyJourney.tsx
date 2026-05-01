import { useEffect, useState, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Compass,
  Loader2,
  Target,
  Plus,
  Trash2,
  Check,
  Sparkles,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Users,
  Bell,
  GraduationCap,
  Lock,
} from "lucide-react";
import {
  format,
  isAfter,
  isBefore,
  startOfWeek,
  endOfWeek,
  differenceInCalendarWeeks,
} from "date-fns";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  GoalWheel,
  GoalScoreCards,
  type GoalRatingRow,
  type SessionRatingSeries,
} from "./journey/GoalWheel";

interface Goal { id: string; title: string; description: string | null; target_date: string | null; status: string; }
interface Milestone { id: string; goal_id: string; title: string; target_date: string | null; is_done: boolean; done_at: string | null; }
interface GoalRating { id: string; goal_id: string; coachee_id: string; start_rating: number; current_rating: number; target_rating: number; current_updated_at: string; }
interface ProgrammeInfo {
  enrollmentId: string;
  programmeName: string;
  startDate: string | null;
  endDate: string | null;
  sessionsAllowed: number;
  durationMonths: number;
}

interface RawActionItem { text: string; done?: boolean; due_date?: string | null; milestone_id?: string | null; }
interface FlatAction extends RawActionItem {
  sessionId: string;
  sessionTopic: string;
  sessionDate: string;
  idx: number;
  source: "coaching" | "peer";
}

const ACCENTS = [
  { bg: "bg-success/15", text: "text-success", fill: "bg-success" },
  { bg: "bg-primary/15", text: "text-primary", fill: "bg-primary" },
  { bg: "bg-warning/15", text: "text-warning", fill: "bg-warning" },
  { bg: "bg-accent", text: "text-accent-foreground", fill: "bg-foreground/60" },
];

function initials(s: string) {
  return s
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

type AnySession = any;

export default function CoachMyJourney() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [coachingSessions, setCoachingSessions] = useState<AnySession[]>([]);
  const [peerSessions, setPeerSessions] = useState<AnySession[]>([]);
  const [reflections, setReflections] = useState<any[]>([]);
  const [coachNames, setCoachNames] = useState<Record<string, string>>({});
  const [usage, setUsage] = useState<{ monthly_limit: number; used_this_month: number } | null>(null);
  const [ratings, setRatings] = useState<Record<string, GoalRating>>({});
  const [sessionRatings, setSessionRatings] = useState<any[]>([]);
  const [programme, setProgramme] = useState<ProgrammeInfo | null>(null);
  const [newReflection, setNewReflection] = useState("");
  const [reflectionMood, setReflectionMood] = useState("");
  const [savingRef, setSavingRef] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const [
      { data: g }, { data: m }, { data: s }, { data: ps }, { data: r }, { data: u },
      { data: gr }, { data: sgr }, { data: enr },
    ] = await Promise.all([
      supabase.from("coachee_goals").select("*").eq("coachee_id", user.id).order("created_at"),
      supabase.from("coachee_milestones").select("*").eq("coachee_id", user.id).order("created_at"),
      supabase.from("sessions").select("*").eq("coachee_id", user.id).order("start_time", { ascending: false }),
      supabase.from("peer_sessions").select("*").eq("peer_coachee_id", user.id).order("start_time", { ascending: false }),
      supabase.from("coachee_reflections").select("*").eq("coachee_id", user.id).order("created_at", { ascending: false }),
      supabase.rpc("get_coachee_session_usage", { _coachee_id: user.id }),
      supabase.from("coachee_goal_ratings").select("*").eq("coachee_id", user.id),
      supabase.from("session_goal_ratings").select("*").eq("coachee_id", user.id),
      supabase
        .from("programme_enrollments")
        .select("id, start_date, end_date, programme_id, programmes(name, coachee_session_limit, duration_months)")
        .eq("coachee_id", user.id)
        .eq("status", "active")
        .order("start_date", { ascending: false })
        .limit(1),
    ]);
    setGoals(g || []);
    setMilestones(m || []);
    setCoachingSessions(s || []);
    setPeerSessions(ps || []);
    setReflections(r || []);
    setSessionRatings(sgr || []);
    const usageRow = Array.isArray(u) ? u[0] : u;
    if (usageRow) setUsage(usageRow as any);

    const rmap: Record<string, GoalRating> = {};
    for (const row of (gr || []) as any[]) rmap[row.goal_id] = row;
    setRatings(rmap);

    const e = (enr || [])[0] as any;
    if (e && e.programmes) {
      setProgramme({
        enrollmentId: e.id,
        programmeName: e.programmes.name,
        startDate: e.start_date,
        endDate: e.end_date,
        sessionsAllowed: e.programmes.coachee_session_limit ?? 0,
        durationMonths: e.programmes.duration_months ?? 0,
      });
    } else {
      setProgramme(null);
    }

    const ids = new Set<string>();
    (s || []).forEach((x: any) => x.coach_id && ids.add(x.coach_id));
    (ps || []).forEach((x: any) => x.peer_coach_id && ids.add(x.peer_coach_id));
    if (ids.size) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", Array.from(ids));
      const map: Record<string, string> = {};
      for (const p of profs || []) map[p.id] = p.full_name;
      setCoachNames(map);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => { refresh(); }, [refresh]);

  // Unified sessions list (each carries _source / _otherCoachId)
  const sessions = useMemo<AnySession[]>(() => [
    ...coachingSessions.map((s) => ({ ...s, _source: "coaching" as const, _otherCoachId: s.coach_id })),
    ...peerSessions.map((s) => ({ ...s, _source: "peer" as const, _otherCoachId: s.peer_coach_id })),
  ], [coachingSessions, peerSessions]);

  // Flatten action items from BOTH sources
  const allActionItems: FlatAction[] = useMemo(() => {
    const out: FlatAction[] = [];
    for (const s of sessions) {
      const items = Array.isArray(s.action_items) ? s.action_items : [];
      items.forEach((it: any, idx: number) => {
        const obj: RawActionItem = typeof it === "string" ? { text: it, done: false } : it;
        if (obj?.text) {
          out.push({
            ...obj,
            sessionId: s.id,
            sessionTopic: s.topic,
            sessionDate: s.start_time,
            idx,
            source: s._source,
          });
        }
      });
    }
    return out;
  }, [sessions]);

  // Auto-complete milestones when all linked actions are done
  useEffect(() => {
    if (loading || !milestones.length) return;
    milestones.forEach((m) => {
      const linked = allActionItems.filter((a) => a.milestone_id === m.id);
      if (!linked.length) return;
      const allDone = linked.every((a) => a.done);
      if (allDone && !m.is_done) {
        supabase
          .from("coachee_milestones")
          .update({ is_done: true, done_at: new Date().toISOString() })
          .eq("id", m.id)
          .then(({ error }) => {
            if (!error) {
              setMilestones((prev) => prev.map((x) => x.id === m.id ? { ...x, is_done: true, done_at: new Date().toISOString() } : x));
            }
          });
      } else if (!allDone && m.is_done) {
        supabase
          .from("coachee_milestones")
          .update({ is_done: false, done_at: null })
          .eq("id", m.id)
          .then(({ error }) => {
            if (!error) {
              setMilestones((prev) => prev.map((x) => x.id === m.id ? { ...x, is_done: false, done_at: null } : x));
            }
          });
      }
    });
  }, [allActionItems, milestones, loading]);

  const goalProgress = (goalId: string) => {
    const ms = milestones.filter((m) => m.goal_id === goalId);
    if (!ms.length) return 0;
    return Math.round((ms.filter((m) => m.is_done).length / ms.length) * 100);
  };
  const totalMs = milestones.length;
  const doneMs = milestones.filter((m) => m.is_done).length;
  const overallPct = totalMs ? Math.round((doneMs / totalMs) * 100) : 0;

  const aiTotal = allActionItems.length;
  const aiDone = allActionItems.filter((a) => a.done).length;
  const aiOverdue = allActionItems.filter(
    (a) => !a.done && a.due_date && isBefore(new Date(a.due_date), new Date())
  ).length;

  const now = new Date();
  const wkEnd = endOfWeek(now, { weekStartsOn: 1 });
  const grouped = {
    overdue: allActionItems.filter((a) => !a.done && a.due_date && isBefore(new Date(a.due_date), now)),
    thisWeek: allActionItems.filter(
      (a) => !a.done && a.due_date && !isBefore(new Date(a.due_date), now) && !isAfter(new Date(a.due_date), wkEnd)
    ),
    upcoming: allActionItems.filter(
      (a) => !a.done && (!a.due_date || isAfter(new Date(a.due_date), wkEnd))
    ),
    completed: allActionItems.filter((a) => a.done),
  };

  const upcoming = sessions
    .filter((s) => new Date(s.start_time) >= now && !["cancelled", "completed"].includes(s.status))
    .sort((a, b) => +new Date(a.start_time) - +new Date(b.start_time));
  const past = sessions
    .filter((s) => new Date(s.start_time) < now || ["cancelled", "completed"].includes(s.status))
    .sort((a, b) => +new Date(b.start_time) - +new Date(a.start_time));

  const nextSession = upcoming[0];

  // Coaches (combining coaching + peer)
  const coachSummaries = useMemo(() => {
    const map = new Map<string, { id: string; name: string; total: number; completed: number; upcoming: number; firstDate: Date | null; lastDate: Date | null; nextDate: Date | null; sources: Set<"coaching" | "peer">; }>();
    for (const s of sessions) {
      const otherId: string | undefined = s._otherCoachId;
      if (!otherId) continue;
      const cur = map.get(otherId) || {
        id: otherId,
        name: coachNames[otherId] || (s._source === "peer" ? "Peer coach" : "Coach"),
        total: 0,
        completed: 0,
        upcoming: 0,
        firstDate: null,
        lastDate: null,
        nextDate: null,
        sources: new Set<"coaching" | "peer">(),
      };
      const d = new Date(s.start_time);
      cur.total += 1;
      cur.sources.add(s._source);
      if (s.status === "completed") cur.completed += 1;
      if (["confirmed", "pending_coach_approval"].includes(s.status) && d >= now) {
        cur.upcoming += 1;
        if (!cur.nextDate || d < cur.nextDate) cur.nextDate = d;
      }
      if (!cur.firstDate || d < cur.firstDate) cur.firstDate = d;
      if (!cur.lastDate || d > cur.lastDate) cur.lastDate = d;
      cur.name = coachNames[otherId] || cur.name;
      map.set(otherId, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [sessions, coachNames, now]);

  const addReflection = async () => {
    if (!newReflection.trim() || !user) return;
    setSavingRef(true);
    const { error } = await supabase.from("coachee_reflections").insert({
      coachee_id: user.id,
      body: newReflection.trim(),
      mood: reflectionMood.trim() || null,
    });
    setSavingRef(false);
    if (error) return toast.error(error.message);
    setNewReflection("");
    setReflectionMood("");
    refresh();
  };

  const deleteReflection = async (id: string) => {
    const { error } = await supabase.from("coachee_reflections").delete().eq("id", id);
    if (error) return toast.error(error.message);
    refresh();
  };

  const toggleMilestone = async (m: Milestone) => {
    const { error } = await supabase
      .from("coachee_milestones")
      .update({ is_done: !m.is_done, done_at: !m.is_done ? new Date().toISOString() : null })
      .eq("id", m.id);
    if (error) return toast.error(error.message);
    refresh();
  };

  const toggleAction = async (a: FlatAction) => {
    const table = a.source === "coaching" ? "sessions" : "peer_sessions";
    const list = a.source === "coaching" ? coachingSessions : peerSessions;
    const sess = list.find((s) => s.id === a.sessionId);
    if (!sess) return;
    const items = Array.isArray(sess.action_items) ? [...sess.action_items] : [];
    const cur = items[a.idx];
    const norm = typeof cur === "string" ? { text: cur, done: false } : { ...cur };
    norm.done = !norm.done;
    items[a.idx] = norm;

    if (a.source === "coaching") {
      setCoachingSessions((prev) => prev.map((s) => s.id === a.sessionId ? { ...s, action_items: items } : s));
    } else {
      setPeerSessions((prev) => prev.map((s) => s.id === a.sessionId ? { ...s, action_items: items } : s));
    }

    const { error } = await supabase.from(table).update({ action_items: items }).eq("id", a.sessionId);
    if (error) {
      toast.error(error.message);
      refresh();
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-soft text-primary">
          <Compass className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">My journey</h1>
          <p className="text-sm text-muted-foreground">
            Your growth as a coachee — across coaching and peer sessions you receive.
          </p>
        </div>
      </div>

      {/* METRICS */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Overall progress" value={`${overallPct}%`} sub={`across ${goals.length} goal${goals.length === 1 ? "" : "s"}`} />
        <Metric label="Actions done" value={String(aiDone)} sub={aiOverdue ? `${aiOverdue} overdue` : `of ${aiTotal} total`} subClass={aiOverdue ? "text-destructive" : ""} />
        <Metric
          label="Sessions received"
          value={
            usage
              ? `${sessions.filter((s) => s.status === "completed").length} / ${usage.monthly_limit}`
              : `${sessions.filter((s) => s.status === "completed").length}`
          }
          sub={`${upcoming.length} upcoming`}
        />
        <Metric
          label="Next session"
          value={nextSession ? format(new Date(nextSession.start_time), "MMM d") : "—"}
          sub={nextSession ? format(new Date(nextSession.start_time), "p") : "Nothing scheduled"}
        />
      </div>

      {/* Coaches */}
      {coachSummaries.length > 0 && (
        <Card className="overflow-hidden">
          <div className="border-b bg-muted/30 px-4 py-2.5">
            <p className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              <Users className="h-3.5 w-3.5" /> Coaches in this programme
            </p>
          </div>
          <ul className="divide-y">
            {coachSummaries.map((c, i) => {
              const accent = ACCENTS[i % ACCENTS.length];
              const dateRange =
                c.firstDate && c.lastDate
                  ? `${format(c.firstDate, "MMM d")} → ${format(c.lastDate, "MMM d")}`
                  : "—";
              const isCoach = c.sources.has("coaching");
              const isPeer = c.sources.has("peer");
              const tag = isCoach && isPeer ? "Coach + Peer" : isCoach ? "Coach" : "Peer";
              return (
                <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold", accent.bg, accent.text)}>
                    {initials(c.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{c.name}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {c.completed}/{c.total} sessions completed
                      {c.nextDate ? ` · Next ${format(c.nextDate, "MMM d, p")}` : ""}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest",
                      isCoach && isPeer ? "bg-warning/15 text-warning" : isCoach ? "bg-primary/15 text-primary" : "bg-success/15 text-success"
                    )}
                  >
                    {tag}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{dateRange}</span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <Tabs defaultValue="home">
        <TabsList>
          <TabsTrigger value="home">Overview</TabsTrigger>
          <TabsTrigger value="goals">Goals & milestones</TabsTrigger>
          <TabsTrigger value="actions">Action items ({aiTotal})</TabsTrigger>
          <TabsTrigger value="sessions">Sessions ({sessions.length})</TabsTrigger>
          <TabsTrigger value="reflections">Reflections ({reflections.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="home" className="mt-4 space-y-6">
          <SectionHeader title="Goals & milestones" />
          {goals.length === 0 ? (
            <EmptyGoals userId={user!.id} onSaved={refresh} />
          ) : (
            <div className="space-y-2">
              {goals.map((g, i) => (
                <GoalAccordion
                  key={g.id}
                  goal={g}
                  milestones={milestones.filter((m) => m.goal_id === g.id)}
                  actions={allActionItems}
                  pct={goalProgress(g.id)}
                  accent={ACCENTS[i % ACCENTS.length]}
                  onToggle={toggleMilestone}
                  onToggleAction={toggleAction}
                  onChanged={refresh}
                  userId={user!.id}
                  defaultOpen={i === 0}
                />
              ))}
            </div>
          )}

          <SectionHeader title="Action items" />
          <ActionGroups grouped={grouped} compact onToggleAction={toggleAction} />
        </TabsContent>

        <TabsContent value="goals" className="mt-4 space-y-3">
          <div className="flex justify-end">
            <GoalDialog onSaved={refresh} userId={user!.id} />
          </div>
          {goals.length === 0 ? (
            <EmptyGoals userId={user!.id} onSaved={refresh} />
          ) : (
            <>
              <div className="grid gap-3 md:grid-cols-3">
                {goals.map((g, i) => {
                  const ac = ACCENTS[i % ACCENTS.length];
                  const pct = goalProgress(g.id);
                  const goalDone = pct === 100 && milestones.filter((m) => m.goal_id === g.id).length > 0;
                  return (
                    <Card key={g.id} className="p-4">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground inline-flex items-center gap-1">
                        {goalDone && <Check className="h-3 w-3 text-success" strokeWidth={3} />}
                        {g.title}
                      </p>
                      <p className="mt-1 text-2xl font-semibold">{pct}%</p>
                      {g.target_date && (
                        <p className="text-[10px] text-muted-foreground">Target {format(new Date(g.target_date), "MMM d, yyyy")}</p>
                      )}
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                        <div className={cn("h-full", ac.fill)} style={{ width: `${pct}%` }} />
                      </div>
                    </Card>
                  );
                })}
              </div>
              <div className="space-y-2">
                {goals.map((g, i) => (
                  <GoalAccordion
                    key={g.id}
                    goal={g}
                    milestones={milestones.filter((m) => m.goal_id === g.id)}
                    actions={allActionItems}
                    pct={goalProgress(g.id)}
                    accent={ACCENTS[i % ACCENTS.length]}
                    onToggle={toggleMilestone}
                    onToggleAction={toggleAction}
                    onChanged={refresh}
                    userId={user!.id}
                    showLinkedActions
                    defaultOpen={i === 0}
                  />
                ))}
              </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="actions" className="mt-4">
          <p className="mb-3 text-xs text-muted-foreground">
            {aiTotal} total · {aiDone} done · {aiOverdue} overdue
          </p>
          <ActionGroups grouped={grouped} milestones={milestones} goals={goals} onToggleAction={toggleAction} />
        </TabsContent>

        <TabsContent value="sessions" className="mt-4 space-y-4">
          <SessionsBlock title="Upcoming" items={upcoming} coachNames={coachNames} />
          <SessionsBlock title="Past & completed" items={past} milestones={milestones} goals={goals} expandable onToggleAction={toggleAction} coachNames={coachNames} />
        </TabsContent>

        <TabsContent value="reflections" className="mt-4 space-y-4">
          <Card className="p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <BookOpen className="h-4 w-4 text-primary" /> New reflection
            </div>
            <Input
              placeholder="Mood (optional, e.g. focused, stuck, proud)…"
              value={reflectionMood}
              onChange={(e) => setReflectionMood(e.target.value)}
              className="mb-2"
            />
            <Textarea
              placeholder="What's on your mind? Wins, blockers, insights…"
              value={newReflection}
              onChange={(e) => setNewReflection(e.target.value)}
              rows={4}
            />
            <div className="mt-2 flex justify-end">
              <Button size="sm" onClick={addReflection} disabled={savingRef || !newReflection.trim()}>
                <Sparkles className="mr-1 h-4 w-4" /> Save reflection
              </Button>
            </div>
          </Card>

          {reflections.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground">Your private reflections will appear here.</p>
          ) : (
            reflections.map((r) => (
              <Card key={r.id} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    {r.mood && (
                      <span className="mb-1 inline-block rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-primary">
                        {r.mood}
                      </span>
                    )}
                    <p className="whitespace-pre-wrap text-sm">{r.body}</p>
                    <p className="mt-2 text-[10px] text-muted-foreground">
                      {format(new Date(r.created_at), "EEE, MMM d, yyyy · p")}
                    </p>
                  </div>
                  <button onClick={() => deleteReflection(r.id)} className="text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ---------- sub components ---------- */

function Metric({ label, value, sub, subClass }: { label: string; value: string; sub?: string; subClass?: string }) {
  return (
    <Card className="p-4">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {sub && <p className={cn("mt-0.5 text-[11px] text-muted-foreground", subClass)}>{sub}</p>}
    </Card>
  );
}

function SectionHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="text-sm font-semibold">{title}</h2>
      {action}
    </div>
  );
}

function EmptyGoals({ userId, onSaved }: { userId: string; onSaved: () => void }) {
  return (
    <Card className="p-12 text-center">
      <Target className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
      <h3 className="font-semibold">Set your first goal</h3>
      <p className="mt-1 mb-4 text-sm text-muted-foreground">
        Define what you want to achieve in your own coaching journey.
      </p>
      <div className="flex justify-center">
        <GoalDialog onSaved={onSaved} userId={userId} />
      </div>
    </Card>
  );
}

function GoalAccordion({
  goal,
  milestones,
  actions,
  pct,
  accent,
  onToggle,
  onToggleAction,
  onChanged,
  userId,
  defaultOpen,
  showLinkedActions = true,
}: {
  goal: Goal;
  milestones: Milestone[];
  actions: FlatAction[];
  pct: number;
  accent: typeof ACCENTS[number];
  onToggle: (m: Milestone) => void;
  onToggleAction: (a: FlatAction) => void;
  onChanged: () => void;
  userId: string;
  defaultOpen?: boolean;
  showLinkedActions?: boolean;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  const [adding, setAdding] = useState(false);
  const [newMs, setNewMs] = useState("");
  const [newDate, setNewDate] = useState("");

  const goalDone = pct === 100 && milestones.length > 0;

  const addMs = async () => {
    if (!newMs.trim()) return;
    const { error } = await supabase.from("coachee_milestones").insert({
      goal_id: goal.id,
      coachee_id: userId,
      title: newMs.trim(),
      target_date: newDate || null,
    });
    if (error) return toast.error(error.message);
    setNewMs("");
    setNewDate("");
    setAdding(false);
    onChanged();
  };

  const deleteGoal = async () => {
    if (!confirm("Delete this goal and all its milestones?")) return;
    const { error } = await supabase.from("coachee_goals").delete().eq("id", goal.id);
    if (error) return toast.error(error.message);
    onChanged();
  };

  const deleteMs = async (id: string) => {
    const { error } = await supabase.from("coachee_milestones").delete().eq("id", id);
    if (error) return toast.error(error.message);
    onChanged();
  };

  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 bg-muted/30 px-3 py-2.5 text-left hover:bg-muted/50"
      >
        <div className={cn("flex h-7 w-7 items-center justify-center rounded-md text-[11px] font-semibold", accent.bg, accent.text)}>
          {initials(goal.title)}
        </div>
        <span className="flex-1 text-sm font-semibold inline-flex items-center gap-1.5">
          {goalDone && <Check className="h-3.5 w-3.5 text-success" strokeWidth={3} />}
          <span>{goal.title}</span>
          {goal.target_date && (
            <span className="ml-2 text-[10px] font-normal text-muted-foreground">
              · target {format(new Date(goal.target_date), "MMM d")}
            </span>
          )}
        </span>
        <span className="text-xs text-muted-foreground">{pct}%</span>
        <div className="hidden h-1 w-14 overflow-hidden rounded-full bg-background sm:block">
          <div className={cn("h-full", accent.fill)} style={{ width: `${pct}%` }} />
        </div>
        {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
      </button>

      {open && (
        <div className="border-t p-4">
          {goal.description && <p className="mb-3 text-xs text-muted-foreground">{goal.description}</p>}
          <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            {showLinkedActions ? "Milestones & linked actions" : "Milestones"}
          </p>
          <ul className="space-y-3">
            {milestones.map((m) => {
              const linked = actions.filter((a) => a.milestone_id === m.id);
              const status: "done" | "active" | "todo" = m.is_done
                ? "done"
                : linked.length || (m.target_date && new Date(m.target_date) < new Date(Date.now() + 1000 * 60 * 60 * 24 * 30))
                ? "active"
                : "todo";
              return (
                <li key={m.id} className="flex items-start gap-3">
                  <button
                    onClick={() => onToggle(m)}
                    className={cn(
                      "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2",
                      status === "done" && "border-success bg-success text-success-foreground",
                      status === "active" && "border-primary bg-primary/40",
                      status === "todo" && "border-border bg-muted",
                    )}
                    aria-label="Toggle milestone"
                  >
                    {m.is_done && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="flex items-center gap-1.5 text-sm font-medium">
                        {m.is_done && <Check className="h-3.5 w-3.5 text-success" strokeWidth={3} />}
                        <span>{m.title}</span>
                      </p>
                      <button onClick={() => deleteMs(m.id)} className="text-muted-foreground hover:text-destructive">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      {m.is_done && m.done_at
                        ? `Done ${format(new Date(m.done_at), "MMM d")}`
                        : m.target_date
                        ? `Target ${format(new Date(m.target_date), "MMM d")}`
                        : "No target date"}
                      {linked.length > 0 && ` · ${linked.filter((a) => a.done).length}/${linked.length} actions`}
                    </p>
                    {showLinkedActions && linked.length > 0 && (
                      <div className="mt-2 space-y-1.5 rounded-md border bg-muted/20 p-2">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                          Linked actions
                        </p>
                        {linked.map((a, i) => (
                          <ActionRow key={i} a={a} hideMilestone onToggle={onToggleAction} />
                        ))}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          {adding ? (
            <div className="mt-3 space-y-2 rounded-lg border bg-muted/30 p-3">
              <Input placeholder="Milestone title" value={newMs} onChange={(e) => setNewMs(e.target.value)} />
              <Input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
                <Button size="sm" onClick={addMs}>Add</Button>
              </div>
            </div>
          ) : (
            <div className="mt-3 flex items-center justify-between">
              <Button variant="ghost" size="sm" onClick={() => setAdding(true)}>
                <Plus className="mr-1 h-3 w-3" /> Add milestone
              </Button>
              <button onClick={deleteGoal} className="text-xs text-muted-foreground hover:text-destructive">
                Delete goal
              </button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function ActionRow({
  a,
  milestoneLabel,
  hideMilestone,
  onToggle,
}: {
  a: FlatAction;
  milestoneLabel?: string;
  hideMilestone?: boolean;
  onToggle?: (a: FlatAction) => void;
}) {
  const overdue = !a.done && a.due_date && isBefore(new Date(a.due_date), new Date());
  return (
    <div className="flex items-start gap-2 py-1">
      <button
        type="button"
        onClick={() => onToggle?.(a)}
        disabled={!onToggle}
        aria-label={a.done ? "Mark as not done" : "Mark as done"}
        className={cn(
          "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border transition-colors",
          a.done && "border-success bg-success text-success-foreground",
          !a.done && overdue && "border-destructive bg-destructive/10 hover:bg-destructive/20",
          !a.done && !overdue && "border-border bg-muted hover:bg-muted/70",
          onToggle ? "cursor-pointer" : "cursor-default"
        )}
      >
        {a.done && <Check className="h-3 w-3" strokeWidth={3} />}
      </button>
      <div className="min-w-0 flex-1">
        <p className="text-xs leading-snug inline-flex items-center gap-1">
          {a.done && <Check className="h-3 w-3 text-success" strokeWidth={3} />}
          <span>{a.text}</span>
        </p>
        <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px]">
          {a.due_date && (
            <span className={cn(overdue ? "text-destructive font-medium" : "text-muted-foreground")}>
              {a.done ? "Done" : overdue ? "Overdue" : "Due"} {format(new Date(a.due_date), "MMM d")}
            </span>
          )}
          {!hideMilestone && milestoneLabel && (
            <span className="text-primary">· {milestoneLabel}</span>
          )}
          <span className={cn(
            "rounded-full px-1.5 text-[9px] font-bold uppercase tracking-wider",
            a.source === "peer" ? "bg-warning/15 text-warning" : "bg-primary/15 text-primary"
          )}>
            {a.source === "peer" ? "Peer" : "Coaching"}
          </span>
          <Link to={`/sessions/${a.sessionId}`} className="text-muted-foreground hover:text-primary">
            · {a.sessionTopic}
          </Link>
        </div>
      </div>
    </div>
  );
}

function ActionGroups({
  grouped,
  milestones,
  goals,
  compact,
  onToggleAction,
}: {
  grouped: { overdue: FlatAction[]; thisWeek: FlatAction[]; upcoming: FlatAction[]; completed: FlatAction[] };
  milestones?: Milestone[];
  goals?: Goal[];
  compact?: boolean;
  onToggleAction?: (a: FlatAction) => void;
}) {
  const labelFor = (a: FlatAction) => {
    if (!milestones || !goals || !a.milestone_id) return undefined;
    const m = milestones.find((x) => x.id === a.milestone_id);
    if (!m) return undefined;
    const g = goals.find((x) => x.id === m.goal_id);
    return g ? `${g.title} → ${m.title}` : m.title;
  };

  const total = grouped.overdue.length + grouped.thisWeek.length + grouped.upcoming.length + grouped.completed.length;
  if (!total) {
    return (
      <Card className="p-12 text-center text-sm text-muted-foreground">
        No action items yet. They'll appear here once a coach assigns them.
      </Card>
    );
  }

  const Group = ({ title, items, danger }: { title: string; items: FlatAction[]; danger?: boolean }) => {
    if (!items.length) return null;
    return (
      <div>
        <p
          className={cn(
            "mb-1 border-b py-1 text-[11px] font-semibold",
            danger ? "border-destructive/30 text-destructive" : "border-border text-muted-foreground"
          )}
        >
          {title} · {items.length}
        </p>
        <div className="divide-y">
          {items.map((a, i) => (
            <ActionRow key={i} a={a} milestoneLabel={labelFor(a)} onToggle={onToggleAction} />
          ))}
        </div>
      </div>
    );
  };

  return (
    <Card className={cn("p-4", compact && "space-y-1")}>
      <Group title="Overdue" items={grouped.overdue} danger />
      <Group title="Due this week" items={grouped.thisWeek} />
      <Group title="Upcoming" items={grouped.upcoming} />
      {!compact && <Group title="Completed" items={grouped.completed} />}
    </Card>
  );
}

function SessionsBlock({
  title,
  items,
  expandable,
  milestones,
  goals,
  onToggleAction,
  coachNames,
}: {
  title: string;
  items: AnySession[];
  expandable?: boolean;
  milestones?: Milestone[];
  goals?: Goal[];
  onToggleAction?: (a: FlatAction) => void;
  coachNames?: Record<string, string>;
}) {
  return (
    <Card className="p-4">
      <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        {title} · {items.length}
      </p>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing here yet.</p>
      ) : (
        <div className="divide-y">
          {items.map((s) => (
            <SessionRow
              key={`${s._source}-${s.id}`}
              s={s}
              expandable={expandable}
              milestones={milestones}
              goals={goals}
              onToggleAction={onToggleAction}
              coachName={coachNames?.[s._otherCoachId]}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

function SessionRow({
  s,
  expandable,
  milestones,
  goals,
  onToggleAction,
  coachName,
}: {
  s: AnySession;
  expandable?: boolean;
  milestones?: Milestone[];
  goals?: Goal[];
  onToggleAction?: (a: FlatAction) => void;
  coachName?: string;
}) {
  const [open, setOpen] = useState(false);
  const d = new Date(s.start_time);
  const items: RawActionItem[] = Array.isArray(s.action_items)
    ? s.action_items.map((it: any) => (typeof it === "string" ? { text: it } : it))
    : [];

  const labelFor = (mid?: string | null) => {
    if (!mid || !milestones || !goals) return undefined;
    const m = milestones.find((x) => x.id === mid);
    if (!m) return undefined;
    const g = goals.find((x) => x.id === m.goal_id);
    return g ? `${g.title} → ${m.title}` : m.title;
  };

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
            {format(d, "p")} · {s.duration_minutes}m{coachName ? ` · ${s._source === "peer" ? "Peer coach" : "Coach"}: ${coachName}` : ""}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <span
              className={cn(
                "inline-block rounded-full px-2 py-0.5 text-[10px] font-medium",
                s.status === "completed" && "bg-success/15 text-success",
                s.status === "confirmed" && "bg-primary/15 text-primary",
                s.status === "cancelled" && "bg-destructive/15 text-destructive",
                s.status === "pending_coach_approval" && "bg-warning/15 text-warning"
              )}
            >
              {s.status.replace(/_/g, " ")}
            </span>
            <span className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
              s._source === "peer" ? "bg-warning/15 text-warning" : "bg-primary/15 text-primary"
            )}>
              {s._source === "peer" ? "Peer" : "Coaching"}
            </span>
            {expandable && (s.coachee_notes || items.length > 0) && (
              <button onClick={() => setOpen((o) => !o)} className="ml-1 text-[11px] text-primary hover:underline">
                {open ? "Hide details ▴" : "Show details ▾"}
              </button>
            )}
          </div>
        </div>
      </div>

      {expandable && open && (
        <div className="mt-2 ml-14 space-y-2 rounded-md bg-muted/30 p-3">
          {s.coachee_notes && (
            <>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Reflection note</p>
              <p className="text-xs italic text-muted-foreground">"{s.coachee_notes}"</p>
            </>
          )}
          {items.length > 0 && (
            <>
              <p className="mt-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Action items from this session
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
                    source: s._source,
                  } as FlatAction}
                  milestoneLabel={labelFor(it.milestone_id)}
                  onToggle={onToggleAction}
                />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function GoalDialog({ onSaved, userId }: { onSaved: () => void; userId: string }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [date, setDate] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!title.trim()) return;
    setSaving(true);
    const { error } = await supabase.from("coachee_goals").insert({
      coachee_id: userId,
      title: title.trim(),
      description: desc.trim() || null,
      target_date: date || null,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    setTitle(""); setDesc(""); setDate("");
    setOpen(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="mr-1 h-4 w-4" /> New goal</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>New goal</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Input placeholder="Goal title (e.g. Become a confident public speaker)" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Textarea placeholder="Why does this matter to you? (optional)" value={desc} onChange={(e) => setDesc(e.target.value)} rows={3} />
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">Target date (optional)</p>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving || !title.trim()}>Save goal</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
