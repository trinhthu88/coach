import { useEffect, useState, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { useJourneyGoals } from "@/hooks/journey/useJourneyGoals";
import { useJourneyRatings } from "@/hooks/journey/useJourneyRatings";
import { useJourneySessions } from "@/hooks/journey/useJourneySessions";
import { useJourneyReflections } from "@/hooks/journey/useJourneyReflections";
import { useJourneyProgramme } from "@/hooks/journey/useJourneyProgramme";
import type { Goal, Milestone, RawActionItem, PeerSessionRow, SessionRow } from "@/hooks/journey/types";
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
import { cn } from "@/lib/utils";
import {
  GoalWheel,
  GoalScoreCards,
  type GoalRatingRow,
  type SessionRatingSeries,
} from "./journey/GoalWheel";

type SessionSourceTag = "coaching" | "peer";

interface FlatAction extends RawActionItem {
  sessionId: string;
  sessionTopic: string;
  sessionDate: string;
  idx: number;
  source: SessionSourceTag;
}

type AnySession = (SessionRow | PeerSessionRow) & {
  _source: SessionSourceTag;
  _otherCoachId?: string | null;
};

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

export default function CoachMyJourney() {
  const { user } = useAuth();
  const goalsApi = useJourneyGoals(user?.id);
  const ratingsApi = useJourneyRatings(user?.id);
  const sessionsApi = useJourneySessions(user?.id, { includePeer: true });
  const reflectionsApi = useJourneyReflections(user?.id);
  const programmeApi = useJourneyProgramme(user?.id);

  const { goals, milestones, toggleMilestone, syncMilestoneDone } = goalsApi;
  const { ratings, sessionRatings, saveRating } = ratingsApi;
  const {
    coachingSessions,
    peerSessions,
    coachNames,
    toggleAction: toggleActionRaw,
  } = sessionsApi;
  const { reflections, deleteReflection } = reflectionsApi;
  const { programme, usage } = programmeApi;

  const loading =
    goalsApi.loading || ratingsApi.loading || sessionsApi.loading || reflectionsApi.loading || programmeApi.loading;

  const refresh = useCallback(() => {
    goalsApi.refresh();
    ratingsApi.refresh();
    sessionsApi.refresh();
    reflectionsApi.refresh();
    programmeApi.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [newReflection, setNewReflection] = useState("");
  const [reflectionMood, setReflectionMood] = useState("");
  const [savingRef, setSavingRef] = useState(false);

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
        syncMilestoneDone(m.id, true);
      } else if (!allDone && m.is_done) {
        syncMilestoneDone(m.id, false);
      }
    });
  }, [allActionItems, milestones, loading, syncMilestoneDone]);

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
      const otherId: string | undefined | null = s._otherCoachId;
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

  // ===== Goal ratings + wheel =====
  const ratingRows: GoalRatingRow[] = useMemo(
    () =>
      goals.map((g) => {
        const r = ratings[g.id];
        return {
          goalId: g.id,
          title: g.title,
          start: r?.start_rating ?? 30,
          current: r?.current_rating ?? 30,
          target: r?.target_rating ?? 80,
        };
      }),
    [goals, ratings]
  );

  const avgGoalProgress = useMemo(() => {
    if (!ratingRows.length) return 0;
    const vals = ratingRows.map((r) => {
      const span = Math.max(1, r.target - r.start);
      const got = Math.max(0, r.current - r.start);
      return Math.min(100, Math.round((got / span) * 100));
    });
    return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  }, [ratingRows]);

  const programmeWeeks = useMemo(() => {
    if (!programme?.startDate) return null;
    const start = new Date(programme.startDate);
    const end = programme.endDate
      ? new Date(programme.endDate)
      : new Date(start.getTime() + (programme.durationMonths || 3) * 30 * 86400000);
    const totalWeeks = Math.max(1, differenceInCalendarWeeks(end, start, { weekStartsOn: 1 }));
    const elapsedWeeks = Math.max(0, Math.min(totalWeeks, differenceInCalendarWeeks(now, start, { weekStartsOn: 1 })));
    return { start, end, totalWeeks, elapsedWeeks };
  }, [programme, now]);

  const sessionsCompletedCount = sessions.filter((s) => s.status === "completed").length;
  // Per-goal lock: locks once any session completes AFTER the goal was created.
  const completedSessionTimes = useMemo(
    () =>
      sessions
        .filter((s) => s.status === "completed")
        .map((s) => new Date(s.start_time).getTime()),
    [sessions]
  );
  const isGoalLocked = useCallback(
    (goalCreatedAt: string) => {
      const created = new Date(goalCreatedAt).getTime();
      return completedSessionTimes.some((t) => t > created);
    },
    [completedSessionTimes]
  );

  const sessionRatingSeries: SessionRatingSeries[] = useMemo(() => {
    const sessionById = new Map(sessions.map((s) => [s.id, s]));
    const grouped = new Map<string, { date: string; rows: { goalId: string; rating: number }[] }>();
    for (const row of sessionRatings) {
      const sess = sessionById.get(row.session_id);
      if (!sess) continue;
      const cur = grouped.get(row.session_id) || { date: sess.start_time, rows: [] };
      cur.rows.push({ goalId: row.goal_id, rating: row.rating });
      grouped.set(row.session_id, cur);
    }
    return Array.from(grouped.entries())
      .map(([sessionId, v]) => ({ sessionId, date: v.date, rows: v.rows }))
      .sort((a, b) => +new Date(a.date) - +new Date(b.date));
  }, [sessionRatings, sessions]);

  const pendingReflectionSession = useMemo(() => {
    const completed = sessions
      .filter((s) => s.status === "completed" && s._source === "coaching")
      .sort((a, b) => +new Date(b.start_time) - +new Date(a.start_time));
    const ratedSessionIds = new Set(sessionRatings.map((r) => r.session_id));
    return completed.find((s) => !ratedSessionIds.has(s.id)) || null;
  }, [sessions, sessionRatings]);

  const needsRatingUpdate = goals.length > 0 && !!pendingReflectionSession;

  const addReflection = async () => {
    if (!newReflection.trim() || !user) return;
    setSavingRef(true);
    const ok = await reflectionsApi.addReflection(newReflection, reflectionMood);
    setSavingRef(false);
    if (!ok) return;
    setNewReflection("");
    setReflectionMood("");
  };

  const toggleAction = (a: FlatAction) => toggleActionRaw(a.sessionId, a.idx, a.source);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (

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
  rating,
  onRatingChange,
  startTargetLocked,
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
  rating?: GoalRatingRow;
  onRatingChange?: (patch: { start_rating?: number; current_rating?: number; target_rating?: number }) => void;
  startTargetLocked?: boolean;
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

          {/* Self-rating sliders — Start & Target only, locked once first session is completed */}
          {rating && onRatingChange && (
            <div className="mb-4 rounded-lg border bg-muted/20 p-3">
              <div className="mb-3 flex items-center justify-between gap-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  Start &amp; Target · 0–100
                </p>
                {startTargetLocked && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground" title="Locked once you complete a session after adding this goal">
                    <Lock className="h-3 w-3" /> Locked
                  </span>
                )}
              </div>
              <div className="space-y-3">
                <RatingSlider
                  label="Start"
                  hint={startTargetLocked ? "Locked after your next completed session" : "Where you are today"}
                  value={rating.start}
                  trackColor="bg-primary/40"
                  disabled={startTargetLocked}
                  onChange={(v) => onRatingChange({ start_rating: v })}
                />
                <RatingSlider
                  label="Target"
                  hint={startTargetLocked ? "Locked after your next completed session" : "Where you want to be"}
                  value={rating.target}
                  trackColor="bg-accent"
                  disabled={startTargetLocked}
                  onChange={(v) => onRatingChange({ target_rating: v })}
                />
              </div>
              <p className="mt-3 text-[10px] text-muted-foreground">
                Your <strong>current</strong> rating is captured after each session in the session log and traced on the wheel.
              </p>
            </div>
          )}

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

function RatingSlider({
  label,
  hint,
  value,
  trackColor,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  trackColor: string;
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  return (
    <div className={cn(disabled && "opacity-60")}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <div>
          <span className="text-[11px] font-semibold">{label}</span>
          {hint && <span className="ml-2 text-[10px] text-muted-foreground">{hint}</span>}
        </div>
        <span className="text-xs font-semibold tabular-nums text-foreground">{local}</span>
      </div>
      <Slider
        value={[local]}
        min={0}
        max={100}
        step={1}
        disabled={disabled}
        onValueChange={(v) => setLocal(v[0])}
        onValueCommit={(v) => onChange(v[0])}
        className={cn("[&_[data-orientation=horizontal]>span]:h-1.5", trackColor && "")}
      />
    </div>
  );
}
