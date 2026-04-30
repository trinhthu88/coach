import { useEffect, useState, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Users,
  Loader2,
  Calendar,
  Target,
  CheckCircle2,
  AlertCircle,
  StickyNote,
  Trash2,
  Search,
  TrendingUp,
  Clock,
  ArrowLeft,
} from "lucide-react";
import { format, isBefore, startOfWeek, endOfWeek, startOfMonth, isAfter } from "date-fns";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Status = "on_track" | "needs_attention" | "at_risk";

interface RawAction {
  text: string;
  done?: boolean;
  due_date?: string | null;
  milestone_id?: string | null;
}

interface Client {
  id: string;
  full_name: string;
  email: string;
  avatar_url: string | null;
  totalSessions: number;
  completed: number;
  cancelled: number;
  upcomingCount: number;
  lastSession: string | null;
  nextSession: string | null;
  goalsActive: number;
  goalsAll: { id: string; title: string }[];
  milestonesDone: number;
  milestonesTotal: number;
  actionItemsDone: number;
  actionItemsTotal: number;
  overdueActions: number;
  status: Status;
  weekStart: string | null;
}

const PALETTES = [
  "bg-primary-soft text-primary",
  "bg-success/15 text-success",
  "bg-warning/15 text-warning",
  "bg-accent text-accent-foreground",
  "bg-secondary text-secondary-foreground",
];

function paletteFor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTES[h % PALETTES.length];
}

function initialsOf(s: string) {
  return (s || "?")
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export default function CoachClients() {
  const { user } = useAuth();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data: ses } = await supabase
      .from("sessions")
      .select("id, coachee_id, status, start_time, action_items")
      .eq("coach_id", user.id);

    const coacheeIds = Array.from(
      new Set(
        (ses || [])
          .filter((s) => ["confirmed", "completed"].includes(s.status))
          .map((s) => s.coachee_id)
      )
    );
    if (!coacheeIds.length) {
      setClients([]);
      setLoading(false);
      return;
    }

    const [{ data: profs }, { data: goals }, { data: miles }] = await Promise.all([
      supabase.from("profiles").select("id, full_name, email, avatar_url").in("id", coacheeIds),
      supabase.from("coachee_goals").select("id, coachee_id, title, status").in("coachee_id", coacheeIds),
      supabase.from("coachee_milestones").select("id, goal_id, coachee_id, is_done").in("coachee_id", coacheeIds),
    ]);

    // Build per-coachee set of milestone_ids referenced by THIS coach's session action items
    const linkedMsByCoachee = new Map<string, Set<string>>();
    for (const s of ses || []) {
      const items: RawAction[] = Array.isArray(s.action_items)
        ? (s.action_items as any[]).map((it) => (typeof it === "string" ? { text: it } : it))
        : [];
      for (const it of items) {
        if (it?.milestone_id) {
          if (!linkedMsByCoachee.has(s.coachee_id)) linkedMsByCoachee.set(s.coachee_id, new Set());
          linkedMsByCoachee.get(s.coachee_id)!.add(it.milestone_id);
        }
      }
    }
    // Visible milestones = those linked. Visible goals = goals owning a visible milestone.
    const visibleMsIds = new Map<string, Set<string>>(); // coachee -> milestone ids
    const visibleGoalIds = new Map<string, Set<string>>(); // coachee -> goal ids
    for (const m of miles || []) {
      const linked = linkedMsByCoachee.get(m.coachee_id);
      if (linked && linked.has(m.id)) {
        if (!visibleMsIds.has(m.coachee_id)) visibleMsIds.set(m.coachee_id, new Set());
        visibleMsIds.get(m.coachee_id)!.add(m.id);
        if (!visibleGoalIds.has(m.coachee_id)) visibleGoalIds.set(m.coachee_id, new Set());
        visibleGoalIds.get(m.coachee_id)!.add(m.goal_id);
      }
    }

    const now = new Date();
    const byCoachee = new Map<string, Client>();
    for (const p of profs || []) {
      byCoachee.set(p.id, {
        id: p.id,
        full_name: p.full_name,
        email: p.email,
        avatar_url: p.avatar_url,
        totalSessions: 0,
        completed: 0,
        cancelled: 0,
        upcomingCount: 0,
        lastSession: null,
        nextSession: null,
        goalsActive: 0,
        goalsAll: [],
        milestonesDone: 0,
        milestonesTotal: 0,
        actionItemsDone: 0,
        actionItemsTotal: 0,
        overdueActions: 0,
        status: "on_track",
        weekStart: null,
      });
    }

    for (const s of ses || []) {
      const c = byCoachee.get(s.coachee_id);
      if (!c) continue;
      c.totalSessions++;
      if (s.status === "completed") c.completed++;
      if (s.status === "cancelled") c.cancelled++;
      const t = new Date(s.start_time);
      if (s.status === "completed" && (!c.lastSession || t > new Date(c.lastSession))) {
        c.lastSession = s.start_time;
      }
      if (
        ["confirmed", "pending_coach_approval"].includes(s.status) &&
        t >= now
      ) {
        c.upcomingCount++;
        if (!c.nextSession || t < new Date(c.nextSession)) c.nextSession = s.start_time;
      }
      if (!c.weekStart || t < new Date(c.weekStart)) c.weekStart = s.start_time;

      const items: RawAction[] = Array.isArray(s.action_items)
        ? (s.action_items as any[]).map((it) => (typeof it === "string" ? { text: it } : it))
        : [];
      for (const it of items) {
        if (!it?.text) continue;
        c.actionItemsTotal++;
        if (it.done) c.actionItemsDone++;
        else if (it.due_date && isBefore(new Date(it.due_date), now)) c.overdueActions++;
      }
    }
    for (const g of goals || []) {
      const c = byCoachee.get(g.coachee_id);
      if (!c) continue;
      const visG = visibleGoalIds.get(g.coachee_id);
      if (!visG || !visG.has(g.id)) continue; // hide goals not linked
      c.goalsAll.push({ id: g.id, title: g.title });
      if (g.status === "active") c.goalsActive++;
    }
    for (const m of miles || []) {
      const c = byCoachee.get(m.coachee_id);
      if (!c) continue;
      const visM = visibleMsIds.get(m.coachee_id);
      if (!visM || !visM.has(m.id)) continue; // hide milestones not linked
      c.milestonesTotal++;
      if (m.is_done) c.milestonesDone++;
    }

    // Status heuristic
    for (const c of byCoachee.values()) {
      if (c.overdueActions >= 5) c.status = "at_risk";
      else if (c.overdueActions >= 1) c.status = "needs_attention";
      else c.status = "on_track";
    }

    setClients(Array.from(byCoachee.values()));
    setLoading(false);
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = clients.filter((c) => {
    const q = search.toLowerCase();
    return !q || c.full_name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q);
  });

  // Top metrics
  const metrics = useMemo(() => {
    const now = new Date();
    const wkStart = startOfWeek(now, { weekStartsOn: 1 });
    const wkEnd = endOfWeek(now, { weekStartsOn: 1 });
    const monthStart = startOfMonth(now);

    const sessionsThisWeek = clients.reduce((acc, c) => {
      if (c.nextSession) {
        const d = new Date(c.nextSession);
        if (!isBefore(d, wkStart) && !isAfter(d, wkEnd)) acc++;
      }
      return acc;
    }, 0);

    const overdue = clients.reduce((a, c) => a + c.overdueActions, 0);
    const overdueClients = clients.filter((c) => c.overdueActions > 0).length;

    // milestones hit this month — approximate using milestonesDone (no done_at on summary). Would need a separate query.
    const milestonesHit = clients.reduce((a, c) => a + c.milestonesDone, 0);

    const nextOverall = clients
      .map((c) => c.nextSession)
      .filter(Boolean)
      .sort((a, b) => +new Date(a!) - +new Date(b!))[0];

    return { active: clients.length, sessionsThisWeek, overdue, overdueClients, milestonesHit, nextOverall };
  }, [clients]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-soft text-primary">
          <Users className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">My clients</h1>
          <p className="text-sm text-muted-foreground">
            All active coachees at a glance — progress, engagement, and private notes.
          </p>
        </div>
      </div>

      {/* METRICS */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricTile
          icon={<Users className="h-4 w-4" />}
          label="Active coachees"
          value={String(metrics.active)}
          sub={`${clients.filter((c) => c.upcomingCount === 0 && c.completed > 0).length} no upcoming`}
        />
        <MetricTile
          icon={<Calendar className="h-4 w-4" />}
          label="Sessions this week"
          value={String(metrics.sessionsThisWeek)}
          sub={metrics.nextOverall ? `next: ${format(new Date(metrics.nextOverall), "MMM d, p")}` : "none scheduled"}
        />
        <MetricTile
          icon={<AlertCircle className="h-4 w-4" />}
          label="Overdue actions"
          value={String(metrics.overdue)}
          sub={metrics.overdue ? `across ${metrics.overdueClients} coachee${metrics.overdueClients === 1 ? "" : "s"}` : "all on time"}
          tone={metrics.overdue ? "danger" : "ok"}
        />
        <MetricTile
          icon={<TrendingUp className="h-4 w-4" />}
          label="Milestones hit"
          value={String(metrics.milestonesHit)}
          sub="completed total"
          tone="ok"
        />
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <p className="text-xs text-muted-foreground">Click a card to open the coachee profile</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : filtered.length === 0 ? (
        <Card className="p-12 text-center">
          <h3 className="text-lg font-semibold">No clients yet</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Coachees appear here once you have a confirmed or completed session.
          </p>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {filtered.map((c) => (
            <ClientCard
              key={c.id}
              client={c}
              onOpen={() => setOpenId(c.id)}
            />
          ))}
        </div>
      )}

      {openId && (
        <ClientDetailDialog
          coacheeId={openId}
          coachId={user!.id}
          onClose={() => setOpenId(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}

/* -------- Components -------- */

function MetricTile({
  icon,
  label,
  value,
  sub,
  tone,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  tone?: "danger" | "ok";
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <p
        className={cn(
          "mt-1 text-2xl font-semibold",
          tone === "danger" && "text-destructive",
          tone === "ok" && "text-success"
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
    </Card>
  );
}

function StatusPill({ status }: { status: Status }) {
  const map: Record<Status, { label: string; cls: string }> = {
    on_track: { label: "On track", cls: "bg-success/15 text-success border-success/20" },
    needs_attention: { label: "Needs attention", cls: "bg-destructive/10 text-destructive border-destructive/20" },
    at_risk: { label: "At risk", cls: "bg-warning/15 text-warning border-warning/20" },
  };
  const m = map[status];
  return (
    <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest", m.cls)}>
      {m.label}
    </span>
  );
}

const FILLS = ["bg-success", "bg-primary", "bg-warning", "bg-accent"];

function ClientCard({ client, onOpen }: { client: Client; onOpen: () => void }) {
  const av = paletteFor(client.id);
  return (
    <Card
      onClick={onOpen}
      className={cn(
        "cursor-pointer p-4 transition-colors hover:border-primary/40",
        client.status !== "on_track" && "border-l-[3px] border-l-destructive"
      )}
    >
      <div className="mb-3 flex items-center gap-3">
        <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold", av)}>
          {client.avatar_url ? (
            <img src={client.avatar_url} alt={client.full_name} className="h-full w-full rounded-full object-cover" />
          ) : (
            initialsOf(client.full_name)
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{client.full_name}</p>
          <p className="truncate text-[11px] text-muted-foreground">
            Session {client.completed}/{client.totalSessions}
            {client.weekStart && ` · since ${format(new Date(client.weekStart), "MMM yyyy")}`}
          </p>
        </div>
        <StatusPill status={client.status} />
      </div>

      {client.goalsAll.length > 0 ? (
        <div className="mb-3 space-y-1.5">
          {client.goalsAll.slice(0, 3).map((g, i) => {
            // We don't have per-goal milestones in the summary; show flat milestone% as proxy on first row,
            // and a placeholder for subsequent rows. Detail dialog has the precise per-goal split.
            const pct =
              i === 0 && client.milestonesTotal
                ? Math.round((client.milestonesDone / client.milestonesTotal) * 100)
                : 0;
            return (
              <div key={g.id} className="flex items-center gap-2">
                <span className="w-28 shrink-0 truncate text-[11px] text-muted-foreground">{g.title}</span>
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                  <div className={cn("h-full rounded-full", FILLS[i % FILLS.length])} style={{ width: `${pct}%` }} />
                </div>
                <span className="w-7 shrink-0 text-right text-[10px] text-muted-foreground">{pct}%</span>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="mb-3 text-[11px] italic text-muted-foreground">No goals set yet</p>
      )}

      <div className="flex flex-wrap gap-1.5">
        {client.nextSession ? (
          <Tag tone="info">Next: {format(new Date(client.nextSession), "MMM d")}</Tag>
        ) : (
          <Tag tone="muted">No upcoming session</Tag>
        )}
        {client.overdueActions > 0 ? (
          <Tag tone="danger">{client.overdueActions} overdue action{client.overdueActions === 1 ? "" : "s"}</Tag>
        ) : client.actionItemsTotal > 0 ? (
          <Tag tone="ok">All actions on time</Tag>
        ) : null}
        {client.cancelled > 0 && <Tag tone="warning">{client.cancelled} cancelled</Tag>}
      </div>
    </Card>
  );
}

function Tag({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "info" | "ok" | "danger" | "warning" | "muted";
}) {
  const map = {
    info: "bg-primary-soft text-primary",
    ok: "bg-success/15 text-success",
    danger: "bg-destructive/10 text-destructive",
    warning: "bg-warning/15 text-warning",
    muted: "bg-muted text-muted-foreground",
  } as const;
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium", map[tone])}>
      {children}
    </span>
  );
}

/* -------- Drill-down dialog -------- */

function ClientDetailDialog({
  coacheeId,
  coachId,
  onClose,
  onChanged,
}: {
  coacheeId: string;
  coachId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [profile, setProfile] = useState<any>(null);
  const [coacheeProfile, setCoacheeProfile] = useState<any>(null);
  const [goals, setGoals] = useState<any[]>([]);
  const [milestones, setMilestones] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [notes, setNotes] = useState<any[]>([]);
  const [newNote, setNewNote] = useState("");
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    const [
      { data: prof },
      { data: cprof },
      { data: g },
      { data: m },
      { data: s },
      { data: n },
    ] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", coacheeId).maybeSingle(),
      supabase.from("coachee_profiles").select("*").eq("id", coacheeId).maybeSingle(),
      supabase.from("coachee_goals").select("*").eq("coachee_id", coacheeId).order("created_at"),
      supabase.from("coachee_milestones").select("*").eq("coachee_id", coacheeId).order("created_at"),
      supabase.from("sessions").select("*").eq("coach_id", coachId).eq("coachee_id", coacheeId).order("start_time", { ascending: false }),
      supabase.from("coach_client_notes").select("*").eq("coach_id", coachId).eq("coachee_id", coacheeId).order("created_at", { ascending: false }),
    ]);
    setProfile(prof);
    setCoacheeProfile(cprof);
    setGoals(g || []);
    setMilestones(m || []);
    setSessions(s || []);
    setNotes(n || []);
  }, [coacheeId, coachId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const addNote = async () => {
    if (!newNote.trim()) return;
    setSaving(true);
    const { error } = await supabase
      .from("coach_client_notes")
      .insert({ coach_id: coachId, coachee_id: coacheeId, body: newNote.trim() });
    setSaving(false);
    if (error) return toast.error(error.message);
    setNewNote("");
    refresh();
    onChanged();
  };

  const deleteNote = async (id: string) => {
    const { error } = await supabase.from("coach_client_notes").delete().eq("id", id);
    if (error) return toast.error(error.message);
    refresh();
  };

  // Aggregate action items across sessions
  const allActions = useMemo(() => {
    const out: { sessionId: string; idx: number; topic: string; date: string; item: RawAction }[] = [];
    for (const s of sessions) {
      const items: RawAction[] = Array.isArray(s.action_items)
        ? (s.action_items as any[]).map((it: any) => (typeof it === "string" ? { text: it } : it))
        : [];
      items.forEach((it, idx) => {
        if (it?.text) out.push({ sessionId: s.id, idx, topic: s.topic, date: s.start_time, item: it });
      });
    }
    return out;
  }, [sessions]);

  const now = new Date();
  const overdue = allActions.filter((a) => !a.item.done && a.item.due_date && isBefore(new Date(a.item.due_date), now));
  const dueWeek = allActions.filter((a) => {
    if (a.item.done || !a.item.due_date) return false;
    const d = new Date(a.item.due_date);
    return !isBefore(d, now) && !isAfter(d, endOfWeek(now, { weekStartsOn: 1 }));
  });
  const completed = allActions.filter((a) => a.item.done);

  const upcoming = sessions.filter((s) => new Date(s.start_time) >= now && !["cancelled", "completed"].includes(s.status));
  const past = sessions.filter((s) => new Date(s.start_time) < now || ["cancelled", "completed"].includes(s.status));

  const totalMs = milestones.length;
  const doneMs = milestones.filter((m) => m.is_done).length;
  const overallPct = totalMs ? Math.round((doneMs / totalMs) * 100) : 0;

  const avPalette = paletteFor(coacheeId);

  const labelFor = (mid?: string | null) => {
    if (!mid) return undefined;
    const m = milestones.find((x) => x.id === mid);
    if (!m) return undefined;
    const g = goals.find((x) => x.id === m.goal_id);
    return g ? `${g.title} → ${m.title}` : m.title;
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="sr-only">{profile?.full_name || "Client"}</DialogTitle>
        </DialogHeader>

        <button onClick={onClose} className="mb-2 inline-flex items-center gap-1 text-xs text-primary hover:underline">
          <ArrowLeft className="h-3 w-3" /> Back to overview
        </button>

        <div className="mb-4 flex items-start gap-3">
          <div className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-sm font-semibold", avPalette)}>
            {profile?.avatar_url ? (
              <img src={profile.avatar_url} alt={profile.full_name} className="h-full w-full rounded-full object-cover" />
            ) : (
              initialsOf(profile?.full_name || "?")
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-lg font-semibold">{profile?.full_name}</p>
            <p className="text-xs text-muted-foreground">
              {profile?.email}
              {coacheeProfile?.job_title && ` · ${coacheeProfile.job_title}`}
              {coacheeProfile?.industry && ` · ${coacheeProfile.industry}`}
            </p>
            {coacheeProfile?.goals && (
              <p className="mt-2 rounded-lg border bg-muted/30 p-2 text-xs">
                <span className="font-semibold">Stated goals:</span> {coacheeProfile.goals}
              </p>
            )}
          </div>
          <div className="hidden grid-cols-3 gap-2 md:grid">
            <MiniMetric label="Overall" value={`${overallPct}%`} />
            <MiniMetric label="Overdue" value={String(overdue.length)} tone={overdue.length ? "danger" : undefined} />
            <MiniMetric label="Next" value={upcoming[0] ? format(new Date(upcoming[upcoming.length - 1].start_time), "MMM d") : "—"} />
          </div>
        </div>

        <Tabs defaultValue="goals">
          <TabsList>
            <TabsTrigger value="goals">Goals & milestones</TabsTrigger>
            <TabsTrigger value="actions">Action items ({allActions.length})</TabsTrigger>
            <TabsTrigger value="sessions">Sessions ({sessions.length})</TabsTrigger>
            <TabsTrigger value="notes">Coach notes ({notes.length})</TabsTrigger>
          </TabsList>

          {/* GOALS */}
          <TabsContent value="goals" className="mt-4 space-y-4">
            {goals.length === 0 ? (
              <p className="text-sm text-muted-foreground">This coachee hasn't set goals yet.</p>
            ) : (
              goals.map((g, gi) => {
                const ms = milestones.filter((m) => m.goal_id === g.id);
                const done = ms.filter((m) => m.is_done).length;
                const pct = ms.length ? Math.round((done / ms.length) * 100) : 0;
                const fill = FILLS[gi % FILLS.length];
                return (
                  <div key={g.id}>
                    <div className="mb-1 flex items-baseline justify-between">
                      <p className="text-sm font-medium">{g.title}</p>
                      <span className="text-xs text-muted-foreground">{pct}% · {done}/{ms.length}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className={cn("h-full rounded-full", fill)} style={{ width: `${pct}%` }} />
                    </div>
                    {ms.length > 0 && (
                      <ul className="ml-1 mt-2 space-y-1.5 border-l-2 border-border pl-3">
                        {ms.map((m) => (
                          <li key={m.id} className="flex items-start gap-2 text-xs">
                            <span
                              className={cn(
                                "mt-1 h-2.5 w-2.5 shrink-0 rounded-full",
                                m.is_done ? "bg-success" : "bg-muted ring-1 ring-border"
                              )}
                            />
                            <div className="flex-1">
                              <p className={cn("flex items-center gap-1", m.is_done && "text-muted-foreground")}>
                                {m.is_done && <CheckCircle2 className="h-3 w-3 text-success" />}
                                {m.title}
                              </p>
                              <p className="text-[10px] text-muted-foreground">
                                {m.is_done && m.done_at
                                  ? `Done ${format(new Date(m.done_at), "MMM d")}`
                                  : m.target_date
                                  ? `Target ${format(new Date(m.target_date), "MMM d")}`
                                  : "No target"}
                              </p>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })
            )}
          </TabsContent>

          {/* ACTIONS */}
          <TabsContent value="actions" className="mt-4">
            {allActions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No action items assigned yet.</p>
            ) : (
              <div className="space-y-4">
                <ActionGroup title="Overdue" tone="danger" items={overdue} labelFor={labelFor} />
                <ActionGroup title="Due this week" items={dueWeek} labelFor={labelFor} />
                <ActionGroup title="Completed" items={completed} labelFor={labelFor} />
              </div>
            )}
          </TabsContent>

          {/* SESSIONS */}
          <TabsContent value="sessions" className="mt-4 space-y-4">
            <div>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Upcoming · {upcoming.length}
              </p>
              {upcoming.length === 0 ? (
                <p className="text-sm text-muted-foreground">None scheduled.</p>
              ) : (
                <div className="space-y-2">
                  {upcoming.map((s) => (
                    <SessionRow key={s.id} s={s} />
                  ))}
                </div>
              )}
            </div>
            <div>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Past · {past.length}
              </p>
              {past.length === 0 ? (
                <p className="text-sm text-muted-foreground">No past sessions.</p>
              ) : (
                <div className="space-y-2">
                  {past.map((s) => (
                    <SessionRow key={s.id} s={s} showRating />
                  ))}
                </div>
              )}
            </div>
          </TabsContent>

          {/* NOTES */}
          <TabsContent value="notes" className="mt-4 space-y-3">
            <p className="text-xs text-muted-foreground">
              Private notes visible only to you. Use to track patterns and coaching strategy.
            </p>
            <Card className="space-y-2 p-3">
              <Textarea
                placeholder="Your private observations about this coachee…"
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                rows={3}
              />
              <div className="flex justify-end">
                <Button onClick={addNote} disabled={saving || !newNote.trim()} size="sm">
                  <StickyNote className="mr-1 h-4 w-4" /> Add note
                </Button>
              </div>
            </Card>
            {notes.length === 0 ? (
              <p className="text-sm text-muted-foreground">No notes yet.</p>
            ) : (
              <div className="space-y-2">
                {notes.map((n) => (
                  <Card key={n.id} className="p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="whitespace-pre-wrap text-sm">{n.body}</p>
                      <button onClick={() => deleteNote(n.id)} className="text-muted-foreground hover:text-destructive">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {format(new Date(n.created_at), "MMM d, yyyy · p")}
                    </p>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function MiniMetric({ label, value, tone }: { label: string; value: string; tone?: "danger" }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-2 text-center">
      <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className={cn("mt-0.5 text-sm font-semibold", tone === "danger" && "text-destructive")}>{value}</p>
    </div>
  );
}

function ActionGroup({
  title,
  tone,
  items,
  labelFor,
}: {
  title: string;
  tone?: "danger";
  items: { sessionId: string; idx: number; topic: string; date: string; item: RawAction }[];
  labelFor: (mid?: string | null) => string | undefined;
}) {
  if (!items.length) return null;
  return (
    <div>
      <p
        className={cn(
          "mb-1 border-b py-1 text-[11px] font-semibold",
          tone === "danger" ? "border-destructive/30 text-destructive" : "border-border text-muted-foreground"
        )}
      >
        {title} · {items.length}
      </p>
      <div className="divide-y">
        {items.map((a) => {
          const overdue = !a.item.done && a.item.due_date && isBefore(new Date(a.item.due_date), new Date());
          const lbl = labelFor(a.item.milestone_id);
          return (
            <div key={`${a.sessionId}-${a.idx}`} className="flex items-start gap-2 py-1.5">
              <span
                className={cn(
                  "mt-1 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border",
                  a.item.done && "border-success bg-success text-success-foreground",
                  !a.item.done && overdue && "border-destructive bg-destructive/10",
                  !a.item.done && !overdue && "border-border bg-muted"
                )}
              >
                {a.item.done && <CheckCircle2 className="h-3 w-3" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className={cn("text-xs", a.item.done && "text-muted-foreground")}>{a.item.text}</p>
                <div className="mt-0.5 flex flex-wrap gap-x-2 text-[10px]">
                  {a.item.due_date && (
                    <span className={cn(overdue ? "font-medium text-destructive" : "text-muted-foreground")}>
                      {a.item.done ? "Done" : overdue ? "Overdue" : "Due"} {format(new Date(a.item.due_date), "MMM d")}
                    </span>
                  )}
                  {lbl && <span className="text-primary">· {lbl}</span>}
                  <Link to={`/sessions/${a.sessionId}`} className="text-muted-foreground hover:text-primary">
                    · {a.topic}
                  </Link>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SessionRow({ s, showRating }: { s: any; showRating?: boolean }) {
  const d = new Date(s.start_time);
  return (
    <Link to={`/sessions/${s.id}`} className="block rounded-lg border p-3 text-sm transition hover:border-primary/40">
      <div className="flex items-start gap-3">
        <div className="w-10 shrink-0 text-center">
          <p className="text-base font-semibold leading-none">{format(d, "d")}</p>
          <p className="text-[10px] uppercase text-muted-foreground">{format(d, "MMM")}</p>
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-medium">{s.topic}</p>
          <p className="text-[11px] text-muted-foreground">
            {format(d, "p")} · {s.duration_minutes}m
          </p>
          <span className="mt-1 inline-block text-[10px] uppercase tracking-widest text-muted-foreground">
            {String(s.status).replace(/_/g, " ")}
          </span>
          {showRating && s.coachee_rating && (
            <p className="mt-1 text-[11px] text-warning">
              {"★".repeat(s.coachee_rating)}
              {"☆".repeat(5 - s.coachee_rating)}{" "}
              <span className="text-muted-foreground">— rated by coachee</span>
            </p>
          )}
          {showRating && s.coachee_rating_comment && (
            <p className="mt-1 rounded-md bg-muted/40 p-2 text-[11px] italic text-muted-foreground">
              "{s.coachee_rating_comment}"
            </p>
          )}
        </div>
      </div>
    </Link>
  );
}
