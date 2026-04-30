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
  Compass,
  Loader2,
  BookOpen,
  Users,
  MessagesSquare,
  Trash2,
  Plus,
} from "lucide-react";
import { format } from "date-fns";
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

  const now = new Date();
  const upcomingSessions = sessions.filter(
    (s) => new Date(s.start_time) >= now && !["cancelled", "completed"].includes(s.status)
  );
  const upcomingPeer = peerReceived.filter(
    (s) => new Date(s.start_time) >= now && !["cancelled", "completed"].includes(s.status)
  );

  const addGoal = async () => {
    const title = window.prompt("Goal title?");
    if (!title || !user) return;
    const { error } = await supabase
      .from("coachee_goals")
      .insert({ coachee_id: user.id, title });
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

  const addMilestone = async (goalId: string) => {
    const title = window.prompt("Milestone?");
    if (!title || !user) return;
    const { error } = await supabase
      .from("coachee_milestones")
      .insert({ coachee_id: user.id, goal_id: goalId, title });
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
            Your growth as a coachee — goals, reflections, and the sessions you've received.
          </p>
        </div>
      </div>

      {/* METRICS */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Overall progress" value={`${overallPct}%`} sub={`${goals.length} goal${goals.length === 1 ? "" : "s"}`} />
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
        <Metric
          label="Reflections"
          value={String(reflections.length)}
          sub="personal notes"
        />
      </div>

      <Tabs defaultValue="goals">
        <TabsList>
          <TabsTrigger value="goals">Goals & milestones</TabsTrigger>
          <TabsTrigger value="sessions">Sessions ({sessions.length})</TabsTrigger>
          <TabsTrigger value="peer">Peer received ({peerReceived.length})</TabsTrigger>
          <TabsTrigger value="reflections">Reflections ({reflections.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="goals" className="mt-4 space-y-3">
          <div className="flex justify-end">
            <Button size="sm" onClick={addGoal}>
              <Plus className="h-4 w-4" /> New goal
            </Button>
          </div>
          {goals.length === 0 ? (
            <Card className="p-8 text-center text-sm text-muted-foreground">
              No goals yet. Add one to start tracking.
            </Card>
          ) : (
            goals.map((g) => {
              const ms = milestones.filter((m) => m.goal_id === g.id);
              const pct = goalProgress(g.id);
              return (
                <Card key={g.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold">{g.title}</p>
                      {g.description && (
                        <p className="text-xs text-muted-foreground">{g.description}</p>
                      )}
                    </div>
                    <span className="text-xs font-semibold text-primary">{pct}%</span>
                  </div>
                  <Progress value={pct} className="mt-2 h-1.5" />
                  <ul className="mt-3 space-y-1.5">
                    {ms.map((m) => (
                      <li key={m.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={m.is_done}
                          onChange={() => toggleMilestone(m)}
                          className="h-4 w-4 cursor-pointer accent-primary"
                        />
                        <span className={cn(m.is_done && "line-through text-muted-foreground")}>
                          {m.title}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-2 h-7 text-xs"
                    onClick={() => addMilestone(g.id)}
                  >
                    <Plus className="h-3 w-3" /> Add milestone
                  </Button>
                </Card>
              );
            })
          )}
        </TabsContent>

        <TabsContent value="sessions" className="mt-4 space-y-2">
          {sessions.length === 0 ? (
            <Card className="p-8 text-center text-sm text-muted-foreground">
              No sessions received yet. <Link to="/coach/find-coach" className="text-primary underline">Find a coach</Link>.
            </Card>
          ) : (
            sessions.map((s) => (
              <Link
                key={s.id}
                to={`/sessions/${s.id}`}
                className="block"
              >
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
              <Link
                key={s.id}
                to={`/sessions/${s.id}?type=peer`}
                className="block"
              >
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

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="p-4">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <p className="mt-1.5 text-2xl font-semibold">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
    </Card>
  );
}
