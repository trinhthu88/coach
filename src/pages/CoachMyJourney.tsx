import { useEffect, useState, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Compass,
  Loader2,
  BookOpen,
  Users,
  MessagesSquare,
  Trash2,
  Plus,
  Check,
  ListTodo,
  Target,
} from "lucide-react";
import { format, isBefore } from "date-fns";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Goal {
  id: string;
  title: string;
  description: string | null;
  target_date: string | null;
  status: string;
}
interface Milestone {
  id: string;
  goal_id: string;
  title: string;
  is_done: boolean;
  target_date: string | null;
  done_at?: string | null;
}
interface RawActionItem {
  text: string;
  done?: boolean;
  due_date?: string | null;
  milestone_id?: string | null;
}
interface FlatAction extends RawActionItem {
  sessionId: string;
  sessionTopic: string;
  sessionDate: string;
  source: "coaching" | "peer";
  idx: number;
}

export default function CoachMyJourney() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [reflections, setReflections] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [peerReceived, setPeerReceived] = useState<any[]>([]);
  const [coachNames, setCoachNames] = useState<Record<string, string>>({});
  const [newReflection, setNewReflection] = useState("");
  const [reflectionMood, setReflectionMood] = useState("");
  const [savingRef, setSavingRef] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const [{ data: g }, { data: m }, { data: r }, { data: s }, { data: p }] = await Promise.all([
      supabase.from("coachee_goals").select("*").eq("coachee_id", user.id).order("created_at"),
      supabase.from("coachee_milestones").select("*").eq("coachee_id", user.id).order("created_at"),
      supabase
        .from("coachee_reflections")
        .select("*")
        .eq("coachee_id", user.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("sessions")
        .select("*")
        .eq("coachee_id", user.id)
        .order("start_time", { ascending: false }),
      supabase
        .from("peer_sessions")
        .select("*")
        .eq("peer_coachee_id", user.id)
        .order("start_time", { ascending: false }),
    ]);
    setGoals(g || []);
    setMilestones(m || []);
    setReflections(r || []);
    setSessions(s || []);
    setPeerReceived(p || []);

    const ids = Array.from(
      new Set([
        ...(s || []).map((x: any) => x.coach_id),
        ...(p || []).map((x: any) => x.peer_coach_id),
      ])
    ).filter(Boolean);
    if (ids.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", ids as string[]);
      const map: Record<string, string> = {};
      (profs || []).forEach((p: any) => (map[p.id] = p.full_name));
      setCoachNames(map);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const overallPct = useMemo(() => {
    if (!milestones.length) return 0;
    return Math.round((milestones.filter((m) => m.is_done).length / milestones.length) * 100);
  }, [milestones]);

  const goalProgress = (goalId: string) => {
    const ms = milestones.filter((m) => m.goal_id === goalId);
    if (!ms.length) return 0;
    return Math.round((ms.filter((m) => m.is_done).length / ms.length) * 100);
  };

  // Aggregate action items from BOTH coaching sessions and peer-received sessions
  const allActions: FlatAction[] = useMemo(() => {
    const out: FlatAction[] = [];
    for (const s of sessions) {
      const items = Array.isArray(s.action_items) ? s.action_items : [];
      items.forEach((it: any, idx: number) => {
        const obj: RawActionItem = typeof it === "string" ? { text: it, done: false } : it;
        if (obj?.text)
          out.push({
            ...obj,
            sessionId: s.id,
            sessionTopic: s.topic,
            sessionDate: s.start_time,
            source: "coaching",
            idx,
          });
      });
    }
    for (const s of peerReceived) {
      const items = Array.isArray(s.action_items) ? s.action_items : [];
      items.forEach((it: any, idx: number) => {
        const obj: RawActionItem = typeof it === "string" ? { text: it, done: false } : it;
        if (obj?.text)
          out.push({
            ...obj,
            sessionId: s.id,
            sessionTopic: s.topic,
            sessionDate: s.start_time,
            source: "peer",
            idx,
          });
      });
    }
    return out;
  }, [sessions, peerReceived]);

  const aiTotal = allActions.length;
  const aiDone = allActions.filter((a) => a.done).length;
  const aiOverdue = allActions.filter(
    (a) => !a.done && a.due_date && isBefore(new Date(a.due_date), new Date())
  ).length;

  const toggleAction = async (a: FlatAction) => {
    const list = a.source === "coaching" ? sessions : peerReceived;
    const setList = a.source === "coaching" ? setSessions : setPeerReceived;
    const sess = list.find((s) => s.id === a.sessionId);
    if (!sess) return;
    const items = Array.isArray(sess.action_items) ? [...sess.action_items] : [];
    const cur = items[a.idx];
    const norm = typeof cur === "string" ? { text: cur, done: false } : { ...cur };
    norm.done = !norm.done;
    items[a.idx] = norm;
    setList((prev: any[]) =>
      prev.map((s) => (s.id === a.sessionId ? { ...s, action_items: items } : s))
    );
    const table = a.source === "coaching" ? "sessions" : "peer_sessions";
    const { error } = await supabase.from(table as any).update({ action_items: items }).eq("id", a.sessionId);
    if (error) {
      toast.error(error.message);
      refresh();
    }
  };

  const linkActionMilestone = async (a: FlatAction, milestoneId: string | null) => {
    const list = a.source === "coaching" ? sessions : peerReceived;
    const setList = a.source === "coaching" ? setSessions : setPeerReceived;
    const sess = list.find((s) => s.id === a.sessionId);
    if (!sess) return;
    const items = Array.isArray(sess.action_items) ? [...sess.action_items] : [];
    const cur = items[a.idx];
    const norm = typeof cur === "string" ? { text: cur, done: false } : { ...cur };
    norm.milestone_id = milestoneId;
    items[a.idx] = norm;
    setList((prev: any[]) =>
      prev.map((s) => (s.id === a.sessionId ? { ...s, action_items: items } : s))
    );
    const table = a.source === "coaching" ? "sessions" : "peer_sessions";
    const { error } = await supabase.from(table as any).update({ action_items: items }).eq("id", a.sessionId);
    if (error) {
      toast.error(error.message);
      refresh();
    } else {
      toast.success(milestoneId ? "Linked to milestone" : "Unlinked");
    }
  };

  const now = new Date();
  const upcomingSessions = sessions.filter(
    (s) => new Date(s.start_time) >= now && !["cancelled", "completed"].includes(s.status)
  );
  const upcomingPeer = peerReceived.filter(
    (s) => new Date(s.start_time) >= now && !["cancelled", "completed"].includes(s.status)
  );

  const toggleMilestone = async (m: Milestone) => {
    const { error } = await supabase
      .from("coachee_milestones")
      .update({ is_done: !m.is_done, done_at: !m.is_done ? new Date().toISOString() : null })
      .eq("id", m.id);
    if (error) return toast.error(error.message);
    refresh();
  };

  const deleteGoal = async (id: string) => {
    if (!confirm("Delete this goal and all its milestones?")) return;
    const { error } = await supabase.from("coachee_goals").delete().eq("id", id);
    if (error) return toast.error(error.message);
    refresh();
  };

  const deleteMilestone = async (id: string) => {
    const { error } = await supabase.from("coachee_milestones").delete().eq("id", id);
    if (error) return toast.error(error.message);
    refresh();
  };

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
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Compass className="h-5 w-5" />
        </div>
        <div>
          <h1 className="font-display text-3xl tracking-tight text-secondary">
            My <em className="not-italic text-primary">journey</em>
          </h1>
          <p className="text-sm text-muted-foreground">
            Your growth as a coachee — goals, action items, and the sessions you've received.
          </p>
        </div>
      </div>

      {/* METRICS */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Overall progress" value={`${overallPct}%`} sub={`${goals.length} goal${goals.length === 1 ? "" : "s"}`} />
        <Metric
          label="Action items"
          value={`${aiDone}/${aiTotal}`}
          sub={aiOverdue ? `${aiOverdue} overdue` : "all on track"}
          subClass={aiOverdue ? "text-destructive" : ""}
        />
        <Metric
          label="Sessions received"
          value={String(sessions.filter((s) => s.status === "completed").length)}
          sub={`${upcomingSessions.length} upcoming`}
        />
        <Metric
          label="Peer received"
          value={String(peerReceived.filter((s) => s.status === "completed").length)}
          sub={`${upcomingPeer.length} upcoming`}
        />
      </div>

      <Tabs defaultValue="goals">
        <TabsList>
          <TabsTrigger value="goals">Goals & milestones</TabsTrigger>
          <TabsTrigger value="actions">Action items ({aiTotal})</TabsTrigger>
          <TabsTrigger value="sessions">Sessions ({sessions.length})</TabsTrigger>
          <TabsTrigger value="peer">Peer received ({peerReceived.length})</TabsTrigger>
          <TabsTrigger value="reflections">Reflections ({reflections.length})</TabsTrigger>
        </TabsList>

        {/* GOALS */}
        <TabsContent value="goals" className="mt-4 space-y-3">
          <div className="flex justify-end">
            <GoalDialog userId={user!.id} onSaved={refresh} />
          </div>
          {goals.length === 0 ? (
            <Card className="p-12 text-center">
              <Target className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
              <h3 className="font-semibold">Set your first goal</h3>
              <p className="mt-1 mb-4 text-sm text-muted-foreground">
                Define what you want to grow into and break it down into milestones.
              </p>
              <div className="flex justify-center">
                <GoalDialog userId={user!.id} onSaved={refresh} />
              </div>
            </Card>
          ) : (
            goals.map((g) => {
              const ms = milestones.filter((m) => m.goal_id === g.id);
              const pct = goalProgress(g.id);
              return (
                <Card key={g.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{g.title}</p>
                      {g.description && (
                        <p className="mt-0.5 text-xs text-muted-foreground">{g.description}</p>
                      )}
                    </div>
                    <span className="shrink-0 text-xs font-semibold text-primary">{pct}%</span>
                  </div>
                  <Progress value={pct} className="mt-2 h-1.5" />

                  {ms.length > 0 && (
                    <ul className="mt-3 space-y-1.5">
                      {ms.map((m) => (
                        <li key={m.id} className="flex items-center gap-2 text-sm">
                          <button
                            onClick={() => toggleMilestone(m)}
                            className={cn(
                              "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2",
                              m.is_done ? "border-success bg-success" : "border-border bg-muted"
                            )}
                            aria-label="Toggle milestone"
                          >
                            {m.is_done && <Check className="h-2.5 w-2.5 text-success-foreground" strokeWidth={3} />}
                          </button>
                          <span className={cn("flex-1", m.is_done && "line-through text-muted-foreground")}>
                            {m.title}
                          </span>
                          {m.target_date && (
                            <span className="text-[10px] text-muted-foreground">
                              {format(new Date(m.target_date), "MMM d")}
                            </span>
                          )}
                          <button
                            onClick={() => deleteMilestone(m.id)}
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="mt-3 flex items-center justify-between border-t pt-2">
                    <MilestoneDialog goalId={g.id} userId={user!.id} onSaved={refresh} />
                    <button
                      onClick={() => deleteGoal(g.id)}
                      className="text-xs text-muted-foreground hover:text-destructive"
                    >
                      Delete goal
                    </button>
                  </div>
                </Card>
              );
            })
          )}
        </TabsContent>

        {/* ACTION ITEMS — synced from all sessions received */}
        <TabsContent value="actions" className="mt-4 space-y-3">
          <Card className="p-4">
            <div className="mb-2 flex items-center gap-2">
              <ListTodo className="h-4 w-4 text-primary" />
              <p className="text-sm font-semibold">All action items</p>
              <span className="text-xs text-muted-foreground">
                · synced from coaching & peer sessions you've received
              </span>
            </div>
            {allActions.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No action items yet. They'll appear here as your coaches assign them.
              </p>
            ) : (
              <div className="divide-y">
                {allActions
                  .sort((a, b) => +new Date(b.sessionDate) - +new Date(a.sessionDate))
                  .map((a, i) => {
                    const overdue =
                      !a.done && a.due_date && isBefore(new Date(a.due_date), new Date());
                    return (
                      <div key={`${a.sessionId}-${a.idx}-${i}`} className="flex items-start gap-2 py-2">
                        <button
                          onClick={() => toggleAction(a)}
                          className={cn(
                            "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border",
                            a.done && "border-success bg-success text-success-foreground",
                            !a.done && overdue && "border-destructive bg-destructive/10",
                            !a.done && !overdue && "border-border bg-muted hover:bg-muted/70"
                          )}
                        >
                          {a.done && <Check className="h-3 w-3" strokeWidth={3} />}
                        </button>
                        <div className="min-w-0 flex-1">
                          <p className={cn("text-sm", a.done && "text-muted-foreground line-through")}>
                            {a.text}
                          </p>
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted-foreground">
                            <span
                              className={cn(
                                "rounded-full px-1.5 py-0.5 font-bold uppercase tracking-widest",
                                a.source === "peer"
                                  ? "bg-warning/15 text-warning"
                                  : "bg-primary/15 text-primary"
                              )}
                            >
                              {a.source === "peer" ? "Peer" : "Coaching"}
                            </span>
                            {a.due_date && (
                              <span className={cn(overdue && "text-destructive font-semibold")}>
                                {a.done ? "Done" : overdue ? "Overdue" : "Due"}{" "}
                                {format(new Date(a.due_date), "MMM d")}
                              </span>
                            )}
                            <Link
                              to={`/sessions/${a.sessionId}${a.source === "peer" ? "?type=peer" : ""}`}
                              className="hover:text-primary"
                            >
                              · {a.sessionTopic}
                            </Link>
                            <select
                              value={a.milestone_id || ""}
                              onChange={(e) => linkActionMilestone(a, e.target.value || null)}
                              className="ml-auto h-6 rounded-md border bg-background px-1.5 text-[10px]"
                              title="Link to a milestone"
                            >
                              <option value="">— No milestone —</option>
                              {milestones.map((m) => {
                                const goal = goals.find((g) => g.id === m.goal_id);
                                return (
                                  <option key={m.id} value={m.id}>
                                    {goal ? `${goal.title} → ${m.title}` : m.title}
                                  </option>
                                );
                              })}
                            </select>
                            {a.milestone_id && (() => {
                              const ms = milestones.find((m) => m.id === a.milestone_id);
                              if (!ms) return null;
                              const goal = goals.find((g) => g.id === ms.goal_id);
                              return (
                                <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-primary">
                                  ↳ {goal ? `${goal.title} → ` : ""}{ms.title}
                                </span>
                              );
                            })()}
                          </div>
                        </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </Card>
        </TabsContent>

        {/* SESSIONS */}
        <TabsContent value="sessions" className="mt-4 space-y-2">
          {sessions.length === 0 ? (
            <Card className="p-8 text-center text-sm text-muted-foreground">
              No sessions received yet.{" "}
              <Link to="/coach/find-coach" className="text-primary underline">Find a coach</Link>.
            </Card>
          ) : (
            sessions.map((s) => (
              <Link key={s.id} to={`/sessions/${s.id}`} className="block">
                <Card className="p-4 transition hover:bg-accent/40">
                  <div className="flex items-center gap-2">
                    <Users className="h-3.5 w-3.5 text-primary" />
                    <p className="font-semibold">{s.topic}</p>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    with {coachNames[s.coach_id] || "Coach"} ·{" "}
                    {format(new Date(s.start_time), "MMM d, yyyy · p")} · {s.duration_minutes} min ·{" "}
                    {s.status.replace(/_/g, " ")}
                  </p>
                </Card>
              </Link>
            ))
          )}
        </TabsContent>

        <TabsContent value="peer" className="mt-4 space-y-2">
          {peerReceived.length === 0 ? (
            <Card className="p-8 text-center text-sm text-muted-foreground">
              No peer sessions received yet.{" "}
              <Link to="/coach/peer-coaching" className="text-primary underline">
                Browse peer coaches
              </Link>
              .
            </Card>
          ) : (
            peerReceived.map((s) => (
              <Link key={s.id} to={`/sessions/${s.id}?type=peer`} className="block">
                <Card className="p-4 transition hover:bg-accent/40">
                  <div className="flex items-center gap-2">
                    <MessagesSquare className="h-3.5 w-3.5 text-warning" />
                    <p className="font-semibold">{s.topic}</p>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    with {coachNames[s.peer_coach_id] || "Peer coach"} ·{" "}
                    {format(new Date(s.start_time), "MMM d, yyyy · p")} · {s.duration_minutes} min ·{" "}
                    {s.status.replace(/_/g, " ")}
                  </p>
                </Card>
              </Link>
            ))
          )}
        </TabsContent>

        <TabsContent value="reflections" className="mt-4 space-y-3">
          <Card className="p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <BookOpen className="h-4 w-4 text-primary" /> New reflection
            </div>
            <Input
              placeholder="Mood (optional)"
              value={reflectionMood}
              onChange={(e) => setReflectionMood(e.target.value)}
              className="mb-2"
            />
            <Textarea
              placeholder="What's on your mind?"
              value={newReflection}
              onChange={(e) => setNewReflection(e.target.value)}
              rows={3}
            />
            <div className="mt-2 flex justify-end">
              <Button size="sm" onClick={addReflection} disabled={savingRef || !newReflection.trim()}>
                {savingRef && <Loader2 className="h-3 w-3 animate-spin" />} Save
              </Button>
            </div>
          </Card>

          {reflections.length === 0 ? (
            <Card className="p-8 text-center text-sm text-muted-foreground">No reflections yet.</Card>
          ) : (
            reflections.map((r) => (
              <Card key={r.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-muted-foreground">
                      {format(new Date(r.created_at), "MMM d, yyyy · p")}
                      {r.mood && ` · mood: ${r.mood}`}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm">{r.body}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => deleteReflection(r.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                </div>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Metric({
  label,
  value,
  sub,
  subClass,
}: { label: string; value: string; sub?: string; subClass?: string }) {
  return (
    <Card className="p-4">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <p className="mt-1.5 text-2xl font-semibold">{value}</p>
      {sub && <p className={cn("mt-0.5 text-[11px] text-muted-foreground", subClass)}>{sub}</p>}
    </Card>
  );
}

function GoalDialog({ userId, onSaved }: { userId: string; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setTitle("");
    setDescription("");
    setTargetDate("");
  };

  const submit = async () => {
    if (!title.trim()) return;
    setSaving(true);
    const { error } = await supabase.from("coachee_goals").insert({
      coachee_id: userId,
      title: title.trim(),
      description: description.trim() || null,
      target_date: targetDate || null,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Goal added");
    reset();
    setOpen(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="h-4 w-4" /> New goal
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New goal</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="g-title">Title</Label>
            <Input
              id="g-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Build a sustainable peer-coaching practice"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="g-desc">Description (optional)</Label>
            <Textarea
              id="g-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Why does this matter to you?"
              rows={3}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="g-date">Target date (optional)</Label>
            <Input
              id="g-date"
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={submit} disabled={saving || !title.trim()}>
            {saving && <Loader2 className="h-3 w-3 animate-spin" />} Save goal
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MilestoneDialog({
  goalId,
  userId,
  onSaved,
}: { goalId: string; userId: string; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!title.trim()) return;
    setSaving(true);
    const { error } = await supabase.from("coachee_milestones").insert({
      coachee_id: userId,
      goal_id: goalId,
      title: title.trim(),
      target_date: targetDate || null,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Milestone added");
    setTitle("");
    setTargetDate("");
    setOpen(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <Plus className="h-3 w-3" /> Add milestone
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New milestone</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="m-title">Title</Label>
            <Input
              id="m-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Complete 10 peer practice sessions"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="m-date">Target date (optional)</Label>
            <Input
              id="m-date"
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={submit} disabled={saving || !title.trim()}>
            {saving && <Loader2 className="h-3 w-3 animate-spin" />} Save milestone
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
