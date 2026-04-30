import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Client {
  id: string;
  full_name: string;
  email: string;
  avatar_url: string | null;
  totalSessions: number;
  completed: number;
  cancelled: number;
  lastSession: string | null;
  nextSession: string | null;
  goals: number;
  milestonesDone: number;
  milestonesTotal: number;
  actionItemsDone: number;
  actionItemsTotal: number;
  status: "active" | "inactive";
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
      supabase.from("coachee_goals").select("id, coachee_id, status").in("coachee_id", coacheeIds),
      supabase
        .from("coachee_milestones")
        .select("id, coachee_id, is_done")
        .in("coachee_id", coacheeIds),
    ]);

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
        lastSession: null,
        nextSession: null,
        goals: 0,
        milestonesDone: 0,
        milestonesTotal: 0,
        actionItemsDone: 0,
        actionItemsTotal: 0,
        status: "inactive",
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
        t >= now &&
        (!c.nextSession || t < new Date(c.nextSession))
      ) {
        c.nextSession = s.start_time;
      }
      const items = Array.isArray(s.action_items) ? s.action_items : [];
      for (const it of items) {
        const obj: any = typeof it === "string" ? { text: it, done: false } : it;
        if (obj?.text) {
          c.actionItemsTotal++;
          if (obj.done) c.actionItemsDone++;
        }
      }
    }
    for (const g of goals || []) {
      const c = byCoachee.get(g.coachee_id);
      if (c && g.status === "active") c.goals++;
    }
    for (const m of miles || []) {
      const c = byCoachee.get(m.coachee_id);
      if (!c) continue;
      c.milestonesTotal++;
      if (m.is_done) c.milestonesDone++;
    }

    // Active = had a session in last 60 days OR has upcoming
    const cutoff = new Date(Date.now() - 60 * 24 * 3600 * 1000);
    for (const c of byCoachee.values()) {
      if (c.nextSession || (c.lastSession && new Date(c.lastSession) > cutoff)) {
        c.status = "active";
      }
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

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-soft text-primary">
          <Users className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">My clients</h1>
          <p className="text-sm text-muted-foreground">
            Roster of coachees you've worked with — progress, engagement and private notes.
          </p>
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search by name or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
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
        <div className="grid gap-4 md:grid-cols-2">
          {filtered.map((c) => (
            <ClientCard key={c.id} client={c} onOpen={() => setOpenId(c.id)} />
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

function ClientCard({ client, onOpen }: { client: Client; onOpen: () => void }) {
  const milestonePct = client.milestonesTotal
    ? Math.round((client.milestonesDone / client.milestonesTotal) * 100)
    : 0;
  const aiPct = client.actionItemsTotal
    ? Math.round((client.actionItemsDone / client.actionItemsTotal) * 100)
    : 0;
  const initials = (client.full_name || "?")
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <Card className="cursor-pointer p-5 transition-colors hover:border-primary/40" onClick={onOpen}>
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-soft font-bold text-primary">
          {client.avatar_url ? (
            <img src={client.avatar_url} alt={client.full_name} className="h-full w-full rounded-xl object-cover" />
          ) : (
            initials
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate font-semibold">{client.full_name}</p>
            <span
              className={cn(
                "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest",
                client.status === "active"
                  ? "border-success/20 bg-success/10 text-success"
                  : "border-border bg-muted text-muted-foreground"
              )}
            >
              {client.status}
            </span>
          </div>
          <p className="truncate text-xs text-muted-foreground">{client.email}</p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3 text-center">
        <Stat label="Sessions" value={String(client.completed)} sub={`of ${client.totalSessions}`} />
        <Stat
          label="Next"
          value={client.nextSession ? format(new Date(client.nextSession), "MMM d") : "—"}
          sub={client.nextSession ? format(new Date(client.nextSession), "p") : ""}
        />
        <Stat
          label="Last"
          value={client.lastSession ? format(new Date(client.lastSession), "MMM d") : "—"}
          sub={client.lastSession ? format(new Date(client.lastSession), "yyyy") : ""}
        />
      </div>

      <div className="mt-4 space-y-2">
        <ProgressRow label="Milestones" pct={milestonePct} sub={`${client.milestonesDone}/${client.milestonesTotal}`} />
        <ProgressRow label="Action items" pct={aiPct} sub={`${client.actionItemsDone}/${client.actionItemsTotal}`} />
      </div>

      <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1"><Target className="h-3 w-3" /> {client.goals} active goals</span>
        {client.cancelled > 0 && (
          <span className="inline-flex items-center gap-1 text-warning">
            <AlertCircle className="h-3 w-3" /> {client.cancelled} cancelled
          </span>
        )}
      </div>
    </Card>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-2">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-semibold">{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

function ProgressRow({ label, pct, sub }: { label: string; pct: number; sub: string }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11px]">
        <span className="font-medium text-muted-foreground">{label}</span>
        <span className="text-muted-foreground">{sub} · {pct}%</span>
      </div>
      <Progress value={pct} className="h-1.5" />
    </div>
  );
}

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
    if (error) {
      toast.error(error.message);
      return;
    }
    setNewNote("");
    refresh();
    onChanged();
  };

  const deleteNote = async (id: string) => {
    const { error } = await supabase.from("coach_client_notes").delete().eq("id", id);
    if (error) return toast.error(error.message);
    refresh();
  };

  const now = new Date();
  const upcoming = sessions.filter((s) => new Date(s.start_time) >= now && !["cancelled", "completed"].includes(s.status));
  const past = sessions.filter((s) => new Date(s.start_time) < now || ["cancelled", "completed"].includes(s.status));

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{profile?.full_name || "Client"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-1 text-sm">
          <p className="text-muted-foreground">{profile?.email}</p>
          {coacheeProfile?.job_title && (
            <p className="text-xs text-muted-foreground">
              {coacheeProfile.job_title}
              {coacheeProfile.industry ? ` · ${coacheeProfile.industry}` : ""}
              {coacheeProfile.location ? ` · ${coacheeProfile.location}` : ""}
            </p>
          )}
          {coacheeProfile?.goals && (
            <p className="rounded-lg border bg-muted/30 p-3 text-xs">
              <span className="font-semibold">Stated goals:</span> {coacheeProfile.goals}
            </p>
          )}
        </div>

        <Tabs defaultValue="progress">
          <TabsList>
            <TabsTrigger value="progress">Progress</TabsTrigger>
            <TabsTrigger value="sessions">Sessions ({sessions.length})</TabsTrigger>
            <TabsTrigger value="notes">My notes ({notes.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="progress" className="mt-4 space-y-3">
            {goals.length === 0 ? (
              <p className="text-sm text-muted-foreground">This coachee hasn't set goals yet.</p>
            ) : (
              goals.map((g) => {
                const ms = milestones.filter((m) => m.goal_id === g.id);
                const done = ms.filter((m) => m.is_done).length;
                const pct = ms.length ? Math.round((done / ms.length) * 100) : 0;
                return (
                  <Card key={g.id} className="p-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-semibold">{g.title}</p>
                        {g.description && <p className="mt-0.5 text-xs text-muted-foreground">{g.description}</p>}
                      </div>
                      {g.target_date && (
                        <span className="text-[10px] text-muted-foreground">
                          by {format(new Date(g.target_date), "MMM d, yyyy")}
                        </span>
                      )}
                    </div>
                    <div className="mt-3">
                      <div className="mb-1 flex justify-between text-xs">
                        <span className="text-muted-foreground">{done}/{ms.length} milestones</span>
                        <span className="text-muted-foreground">{pct}%</span>
                      </div>
                      <Progress value={pct} className="h-1.5" />
                    </div>
                    {ms.length > 0 && (
                      <ul className="mt-3 space-y-1 text-xs">
                        {ms.map((m) => (
                          <li key={m.id} className={cn("flex items-center gap-2", m.is_done && "text-muted-foreground line-through")}>
                            <CheckCircle2 className={cn("h-3 w-3", m.is_done ? "text-success" : "text-muted-foreground")} />
                            {m.title}
                            {m.target_date && (
                              <span className="ml-auto text-[10px] text-muted-foreground">
                                {format(new Date(m.target_date), "MMM d")}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </Card>
                );
              })
            )}
          </TabsContent>

          <TabsContent value="sessions" className="mt-4 space-y-4">
            <div>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Upcoming ({upcoming.length})
              </p>
              {upcoming.length === 0 ? (
                <p className="text-sm text-muted-foreground">None scheduled.</p>
              ) : (
                <div className="space-y-2">{upcoming.map((s) => <SessionRow key={s.id} s={s} />)}</div>
              )}
            </div>
            <div>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Past ({past.length})
              </p>
              {past.length === 0 ? (
                <p className="text-sm text-muted-foreground">No past sessions.</p>
              ) : (
                <div className="space-y-2">{past.map((s) => <SessionRow key={s.id} s={s} />)}</div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="notes" className="mt-4 space-y-3">
            <div className="space-y-2">
              <Textarea
                placeholder="Private note about this client (only you can see this)…"
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                rows={3}
              />
              <Button onClick={addNote} disabled={saving || !newNote.trim()} size="sm">
                <StickyNote className="mr-1 h-4 w-4" /> Add note
              </Button>
            </div>
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

function SessionRow({ s }: { s: any }) {
  return (
    <Link to={`/sessions/${s.id}`} className="block rounded-lg border p-3 text-sm transition hover:border-primary/40">
      <div className="flex items-center justify-between">
        <span className="font-medium">{s.topic}</span>
        <span className="text-xs text-muted-foreground">{format(new Date(s.start_time), "MMM d, yyyy · p")}</span>
      </div>
      <p className="mt-0.5 text-[10px] uppercase tracking-widest text-muted-foreground">{s.status.replace(/_/g, " ")}</p>
    </Link>
  );
}
