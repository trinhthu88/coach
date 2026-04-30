import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
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
  Calendar,
  CheckCircle2,
  Sparkles,
  BookOpen,
  ListTodo,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Goal { id: string; title: string; description: string | null; target_date: string | null; status: string; }
interface Milestone { id: string; goal_id: string; title: string; target_date: string | null; is_done: boolean; }

export default function CoacheeJourney() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [reflections, setReflections] = useState<any[]>([]);
  const [newReflection, setNewReflection] = useState("");
  const [reflectionMood, setReflectionMood] = useState("");
  const [savingRef, setSavingRef] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const [{ data: g }, { data: m }, { data: s }, { data: r }] = await Promise.all([
      supabase.from("coachee_goals").select("*").eq("coachee_id", user.id).order("created_at"),
      supabase.from("coachee_milestones").select("*").eq("coachee_id", user.id).order("created_at"),
      supabase.from("sessions").select("*").eq("coachee_id", user.id).order("start_time", { ascending: false }),
      supabase.from("coachee_reflections").select("*").eq("coachee_id", user.id).order("created_at", { ascending: false }),
    ]);
    setGoals(g || []);
    setMilestones(m || []);
    setSessions(s || []);
    setReflections(r || []);
    setLoading(false);
  }, [user]);

  useEffect(() => { refresh(); }, [refresh]);

  const totalMs = milestones.length;
  const doneMs = milestones.filter((m) => m.is_done).length;
  const overallPct = totalMs ? Math.round((doneMs / totalMs) * 100) : 0;

  const allActionItems: { sessionId: string; date: string; topic: string; text: string; done: boolean; idx: number }[] = [];
  for (const s of sessions) {
    const items = Array.isArray(s.action_items) ? s.action_items : [];
    items.forEach((it: any, idx: number) => {
      const obj = typeof it === "string" ? { text: it, done: false } : it;
      if (obj?.text) allActionItems.push({ sessionId: s.id, date: s.start_time, topic: s.topic, text: obj.text, done: !!obj.done, idx });
    });
  }
  const aiTotal = allActionItems.length;
  const aiDone = allActionItems.filter((a) => a.done).length;
  const aiPct = aiTotal ? Math.round((aiDone / aiTotal) * 100) : 0;

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

  const now = new Date();
  const upcoming = sessions.filter((s) => new Date(s.start_time) >= now && !["cancelled", "completed"].includes(s.status));
  const past = sessions.filter((s) => new Date(s.start_time) < now || ["cancelled", "completed"].includes(s.status));

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
            Track your goals, action items, sessions and personal reflections.
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <SummaryCard label="Active goals" value={String(goals.filter((g) => g.status === "active").length)} icon={Target} />
        <SummaryCard label="Milestones" value={`${doneMs} / ${totalMs}`} sub={`${overallPct}% complete`} pct={overallPct} icon={CheckCircle2} />
        <SummaryCard label="Action items" value={`${aiDone} / ${aiTotal}`} sub={`${aiPct}% done`} pct={aiPct} icon={ListTodo} />
      </div>

      <Tabs defaultValue="goals">
        <TabsList>
          <TabsTrigger value="goals">Goals & milestones</TabsTrigger>
          <TabsTrigger value="timeline">Sessions ({sessions.length})</TabsTrigger>
          <TabsTrigger value="actions">Action items ({aiTotal})</TabsTrigger>
          <TabsTrigger value="reflections">Reflections ({reflections.length})</TabsTrigger>
        </TabsList>

        {/* GOALS */}
        <TabsContent value="goals" className="mt-4 space-y-3">
          <div className="flex justify-end">
            <GoalDialog onSaved={refresh} userId={user!.id} />
          </div>
          {goals.length === 0 ? (
            <Card className="p-12 text-center">
              <Target className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
              <h3 className="font-semibold">Set your first goal</h3>
              <p className="mt-1 text-sm text-muted-foreground">Define what you want to achieve through coaching.</p>
            </Card>
          ) : (
            goals.map((g) => (
              <GoalCard
                key={g.id}
                goal={g}
                milestones={milestones.filter((m) => m.goal_id === g.id)}
                onChanged={refresh}
                onToggle={toggleMilestone}
                userId={user!.id}
              />
            ))
          )}
        </TabsContent>

        {/* TIMELINE */}
        <TabsContent value="timeline" className="mt-4 space-y-4">
          <TimelineSection title="Upcoming" items={upcoming} />
          <TimelineSection title="Past" items={past} />
        </TabsContent>

        {/* ACTION ITEMS */}
        <TabsContent value="actions" className="mt-4">
          {allActionItems.length === 0 ? (
            <Card className="p-12 text-center text-sm text-muted-foreground">
              No action items yet. They'll appear here once your coach assigns them.
            </Card>
          ) : (
            <Card className="divide-y">
              {allActionItems
                .sort((a, b) => Number(a.done) - Number(b.done) || +new Date(b.date) - +new Date(a.date))
                .map((a, i) => (
                  <div key={i} className="flex items-start gap-3 p-3 text-sm">
                    <div className={cn("mt-0.5 h-4 w-4 shrink-0 rounded-full border-2", a.done ? "border-success bg-success" : "border-muted-foreground")}>
                      {a.done && <CheckCircle2 className="h-3.5 w-3.5 text-success-foreground" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={cn(a.done && "text-muted-foreground line-through")}>{a.text}</p>
                      <Link to={`/sessions/${a.sessionId}`} className="text-[11px] text-muted-foreground hover:text-primary">
                        {a.topic} · {format(new Date(a.date), "MMM d, yyyy")}
                      </Link>
                    </div>
                  </div>
                ))}
            </Card>
          )}
        </TabsContent>

        {/* REFLECTIONS */}
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

function SummaryCard({
  label,
  value,
  sub,
  pct,
  icon: Icon,
}: {
  label: string;
  value: string;
  sub?: string;
  pct?: number;
  icon: any;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-semibold">{value}</p>
          {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-soft text-primary">
          <Icon className="h-5 w-5" />
        </div>
      </div>
      {typeof pct === "number" && <Progress value={pct} className="mt-3 h-1.5" />}
    </Card>
  );
}

function GoalCard({
  goal,
  milestones,
  onChanged,
  onToggle,
  userId,
}: {
  goal: Goal;
  milestones: Milestone[];
  onChanged: () => void;
  onToggle: (m: Milestone) => void;
  userId: string;
}) {
  const done = milestones.filter((m) => m.is_done).length;
  const pct = milestones.length ? Math.round((done / milestones.length) * 100) : 0;
  const [adding, setAdding] = useState(false);
  const [newMs, setNewMs] = useState("");
  const [newDate, setNewDate] = useState("");

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
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{goal.title}</p>
          {goal.description && <p className="mt-0.5 text-xs text-muted-foreground">{goal.description}</p>}
          {goal.target_date && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              <Calendar className="mr-1 inline h-3 w-3" /> Target: {format(new Date(goal.target_date), "MMM d, yyyy")}
            </p>
          )}
        </div>
        <button onClick={deleteGoal} className="text-muted-foreground hover:text-destructive">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3">
        <div className="mb-1 flex justify-between text-xs">
          <span className="text-muted-foreground">{done}/{milestones.length} milestones</span>
          <span className="text-muted-foreground">{pct}%</span>
        </div>
        <Progress value={pct} className="h-1.5" />
      </div>

      <ul className="mt-4 space-y-2">
        {milestones.map((m) => (
          <li key={m.id} className="flex items-center gap-2 text-sm">
            <Checkbox checked={m.is_done} onCheckedChange={() => onToggle(m)} />
            <span className={cn("flex-1", m.is_done && "text-muted-foreground line-through")}>{m.title}</span>
            {m.target_date && (
              <span className="text-[10px] text-muted-foreground">{format(new Date(m.target_date), "MMM d")}</span>
            )}
            <button onClick={() => deleteMs(m.id)} className="text-muted-foreground hover:text-destructive">
              <Trash2 className="h-3 w-3" />
            </button>
          </li>
        ))}
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
        <Button variant="ghost" size="sm" className="mt-2" onClick={() => setAdding(true)}>
          <Plus className="mr-1 h-3 w-3" /> Add milestone
        </Button>
      )}
    </Card>
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

function TimelineSection({ title, items }: { title: string; items: any[] }) {
  return (
    <div>
      <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        {title} ({items.length})
      </p>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing here yet.</p>
      ) : (
        <div className="space-y-2">
          {items.map((s) => (
            <Link key={s.id} to={`/sessions/${s.id}`} className="block rounded-lg border p-3 text-sm transition hover:border-primary/40">
              <div className="flex items-center justify-between">
                <span className="font-medium">{s.topic}</span>
                <span className="text-xs text-muted-foreground">{format(new Date(s.start_time), "MMM d, yyyy · p")}</span>
              </div>
              <p className="mt-0.5 text-[10px] uppercase tracking-widest text-muted-foreground">{s.status.replace(/_/g, " ")}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
