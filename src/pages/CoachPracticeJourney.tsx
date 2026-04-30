import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Layers, Loader2, MessageSquareQuote, TrendingUp } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from "recharts";

const COMPETENCIES = [
  { key: "ethical_practice", label: "Ethical practice" },
  { key: "coaching_mindset", label: "Coaching mindset" },
  { key: "maintains_agreements", label: "Maintains agreements" },
  { key: "trust_safety", label: "Trust & safety" },
  { key: "maintains_presence", label: "Maintains presence" },
  { key: "listens_actively", label: "Listens actively" },
  { key: "evokes_awareness", label: "Evokes awareness" },
  { key: "facilitates_growth", label: "Facilitates growth" },
] as const;

type CompKey = (typeof COMPETENCIES)[number]["key"];

interface Entry {
  id: string;
  topic: string;
  start_time: string;
  duration_minutes: number;
  status: string;
  kind: "coached" | "peer-given" | "peer-received";
  counterpart_id: string;
}

interface Feedback {
  id: string;
  peer_session_id: string;
  created_at: string;
  feedback_note: string | null;
  peer_coachee_id: string;
  ethical_practice: number | null;
  coaching_mindset: number | null;
  maintains_agreements: number | null;
  trust_safety: number | null;
  maintains_presence: number | null;
  listens_actively: number | null;
  evokes_awareness: number | null;
  facilitates_growth: number | null;
}

export default function CoachPracticeJourney() {
  const { user } = useAuth();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [profilesById, setProfilesById] = useState<Record<string, { full_name: string }>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const [{ data: coached }, { data: peer }, { data: fb }] = await Promise.all([
        supabase
          .from("sessions")
          .select("id, topic, start_time, duration_minutes, status, coach_id")
          .eq("coachee_id", user.id),
        supabase
          .from("peer_sessions")
          .select("id, topic, start_time, duration_minutes, status, peer_coach_id, peer_coachee_id")
          .or(`peer_coach_id.eq.${user.id},peer_coachee_id.eq.${user.id}`),
        supabase
          .from("peer_session_competency_feedback")
          .select("*")
          .eq("peer_coach_id", user.id)
          .order("created_at", { ascending: true }),
      ]);

      const list: Entry[] = [];
      (coached || []).forEach((s: any) =>
        list.push({
          id: s.id,
          topic: s.topic,
          start_time: s.start_time,
          duration_minutes: s.duration_minutes,
          status: s.status,
          kind: "coached",
          counterpart_id: s.coach_id,
        })
      );
      (peer || []).forEach((s: any) =>
        list.push({
          id: s.id,
          topic: s.topic,
          start_time: s.start_time,
          duration_minutes: s.duration_minutes,
          status: s.status,
          kind: s.peer_coach_id === user.id ? "peer-given" : "peer-received",
          counterpart_id: s.peer_coach_id === user.id ? s.peer_coachee_id : s.peer_coach_id,
        })
      );
      list.sort((a, b) => +new Date(b.start_time) - +new Date(a.start_time));
      setEntries(list);
      setFeedback((fb || []) as Feedback[]);

      const ids = Array.from(
        new Set([
          ...list.map((e) => e.counterpart_id),
          ...(fb || []).map((f: any) => f.peer_coachee_id),
        ])
      );
      if (ids.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", ids);
        const map: Record<string, any> = {};
        (profs || []).forEach((p: any) => (map[p.id] = p));
        setProfilesById(map);
      }
      setLoading(false);
    })();
  }, [user]);

  const stats = useMemo(() => {
    const booked = entries.filter((e) =>
      ["pending_coach_approval", "confirmed", "completed"].includes(e.status)
    );
    const completed = entries.filter((e) => e.status === "completed");
    const tally = (kind: Entry["kind"], src: Entry[]) =>
      src.filter((e) => e.kind === kind).length;
    return {
      coached: { booked: tally("coached", booked), completed: tally("coached", completed) },
      peerGiven: { booked: tally("peer-given", booked), completed: tally("peer-given", completed) },
      peerReceived: {
        booked: tally("peer-received", booked),
        completed: tally("peer-received", completed),
      },
    };
  }, [entries]);

  // Radar averages across all feedback
  const radarData = useMemo(() => {
    if (!feedback.length) return COMPETENCIES.map((c) => ({ competency: c.label, score: 0 }));
    return COMPETENCIES.map((c) => {
      const vals = feedback.map((f) => f[c.key as CompKey]).filter((v): v is number => v != null);
      const avg = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
      return { competency: c.label, score: Math.round(avg) };
    });
  }, [feedback]);

  // Trend data: per feedback entry, plot all 8 scores over time
  const trendData = useMemo(() => {
    return feedback.map((f, i) => {
      const row: any = {
        idx: i + 1,
        date: format(new Date(f.created_at), "MMM d"),
      };
      COMPETENCIES.forEach((c) => {
        row[c.label] = f[c.key as CompKey];
      });
      return row;
    });
  }, [feedback]);

  // Strengths & growth edges
  const insights = useMemo(() => {
    const scored = radarData.filter((r) => r.score > 0);
    const sorted = [...scored].sort((a, b) => b.score - a.score);
    return {
      strengths: sorted.slice(0, 3),
      growth: sorted.slice(-3).reverse(),
    };
  }, [radarData]);

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
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-warning/15 text-warning">
          <Layers className="h-5 w-5" />
        </div>
        <div>
          <h1 className="font-display text-3xl tracking-tight text-secondary">
            Practice <em className="not-italic text-primary">analytics</em>
          </h1>
          <p className="text-sm text-muted-foreground">
            Your sessions, peer-coaching activity, and ICF competency feedback at a glance.
          </p>
        </div>
      </div>

      {/* COUNTERS */}
      <div className="grid gap-3 md:grid-cols-3">
        <CounterTile
          title="Sessions received"
          subtitle="From a coach"
          booked={stats.coached.booked}
          completed={stats.coached.completed}
          tone="primary"
        />
        <CounterTile
          title="Peer sessions given"
          subtitle="You as peer-coach"
          booked={stats.peerGiven.booked}
          completed={stats.peerGiven.completed}
          tone="warning"
        />
        <CounterTile
          title="Peer sessions received"
          subtitle="You as peer-coachee"
          booked={stats.peerReceived.booked}
          completed={stats.peerReceived.completed}
          tone="success"
        />
      </div>

      <Tabs defaultValue="competencies">
        <TabsList>
          <TabsTrigger value="competencies">Competencies</TabsTrigger>
          <TabsTrigger value="trend">Trend</TabsTrigger>
          <TabsTrigger value="feedback">Feedback ({feedback.length})</TabsTrigger>
          <TabsTrigger value="log">Practice log ({entries.length})</TabsTrigger>
        </TabsList>

        {/* RADAR + INSIGHTS */}
        <TabsContent value="competencies" className="mt-4 space-y-4">
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="p-5 lg:col-span-2">
              <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                ICF competency average (0–100)
              </p>
              {feedback.length === 0 ? (
                <EmptyHint text="No feedback yet — your first peer-coachee rating will appear here." />
              ) : (
                <div className="h-[360px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={radarData} outerRadius="75%">
                      <PolarGrid stroke="hsl(var(--border))" />
                      <PolarAngleAxis
                        dataKey="competency"
                        tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                      />
                      <PolarRadiusAxis
                        angle={90}
                        domain={[0, 100]}
                        tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                      />
                      <Radar
                        name="Average"
                        dataKey="score"
                        stroke="hsl(var(--primary))"
                        fill="hsl(var(--primary))"
                        fillOpacity={0.35}
                      />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>

            <div className="space-y-3">
              <Card className="p-4">
                <p className="text-[10px] font-bold uppercase tracking-widest text-success">
                  Strengths
                </p>
                {insights.strengths.length === 0 ? (
                  <p className="mt-2 text-xs text-muted-foreground">No data yet.</p>
                ) : (
                  <ul className="mt-2 space-y-1.5">
                    {insights.strengths.map((s) => (
                      <li key={s.competency} className="flex justify-between text-sm">
                        <span className="truncate">{s.competency}</span>
                        <span className="font-semibold text-success">{s.score}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              <Card className="p-4">
                <p className="text-[10px] font-bold uppercase tracking-widest text-warning">
                  Growth edges
                </p>
                {insights.growth.length === 0 ? (
                  <p className="mt-2 text-xs text-muted-foreground">No data yet.</p>
                ) : (
                  <ul className="mt-2 space-y-1.5">
                    {insights.growth.map((s) => (
                      <li key={s.competency} className="flex justify-between text-sm">
                        <span className="truncate">{s.competency}</span>
                        <span className="font-semibold text-warning">{s.score}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* TREND */}
        <TabsContent value="trend" className="mt-4">
          <Card className="p-5">
            <div className="mb-3 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Competency scores over time
              </p>
            </div>
            {trendData.length === 0 ? (
              <EmptyHint text="No feedback yet." />
            ) : (
              <div className="h-[400px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="date"
                      tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                    />
                    <YAxis
                      domain={[0, 100]}
                      tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {COMPETENCIES.map((c, i) => (
                      <Line
                        key={c.key}
                        type="monotone"
                        dataKey={c.label}
                        stroke={`hsl(${(i * 45) % 360}, 65%, 50%)`}
                        strokeWidth={2}
                        dot={{ r: 3 }}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>
        </TabsContent>

        {/* FEEDBACK FEED */}
        <TabsContent value="feedback" className="mt-4 space-y-3">
          {feedback.length === 0 ? (
            <Card className="p-8">
              <EmptyHint text="No written feedback yet." />
            </Card>
          ) : (
            [...feedback].reverse().map((f) => (
              <Card key={f.id} className="p-4">
                <div className="flex items-start gap-3">
                  <MessageSquareQuote className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-muted-foreground">
                      from {profilesById[f.peer_coachee_id]?.full_name || "Peer"} ·{" "}
                      {format(new Date(f.created_at), "MMM d, yyyy")}
                    </p>
                    {f.feedback_note ? (
                      <p className="mt-1.5 whitespace-pre-wrap text-sm">{f.feedback_note}</p>
                    ) : (
                      <p className="mt-1.5 text-sm italic text-muted-foreground">
                        No written note provided.
                      </p>
                    )}
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {COMPETENCIES.map((c) => {
                        const v = f[c.key as CompKey];
                        if (v == null) return null;
                        return (
                          <span
                            key={c.key}
                            className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px]"
                          >
                            <span className="text-muted-foreground">{c.label}</span>
                            <span className="font-bold">{v}</span>
                          </span>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </Card>
            ))
          )}
        </TabsContent>

        {/* LOG */}
        <TabsContent value="log" className="mt-4">
          <Card className="p-5">
            {entries.length === 0 ? (
              <EmptyHint text="No entries yet." />
            ) : (
              <ul className="divide-y">
                {entries.map((e) => {
                  const counterpart = profilesById[e.counterpart_id]?.full_name || "—";
                  return (
                    <li key={`${e.kind}-${e.id}`} className="py-3">
                      <div className="flex items-center gap-2">
                        <KindBadge kind={e.kind} />
                        <p className="font-semibold">{e.topic}</p>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        with {counterpart} · {format(new Date(e.start_time), "MMM d, yyyy · p")} ·{" "}
                        {e.duration_minutes} min · {e.status.replace(/_/g, " ")}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function CounterTile({
  title,
  subtitle,
  booked,
  completed,
  tone,
}: {
  title: string;
  subtitle: string;
  booked: number;
  completed: number;
  tone: "primary" | "warning" | "success";
}) {
  const toneMap = {
    primary: "bg-primary/10 text-primary",
    warning: "bg-warning/15 text-warning",
    success: "bg-success/15 text-success",
  };
  return (
    <Card className="p-5">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        {title}
      </p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{subtitle}</p>
      <div className="mt-3 flex items-baseline gap-4">
        <div>
          <p className="text-2xl font-semibold">{booked}</p>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Booked</p>
        </div>
        <div>
          <p className={cn("text-2xl font-semibold", toneMap[tone].split(" ")[1])}>{completed}</p>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Completed</p>
        </div>
      </div>
    </Card>
  );
}

function KindBadge({ kind }: { kind: Entry["kind"] }) {
  const map = {
    coached: { label: "Coached", className: "bg-primary/15 text-primary" },
    "peer-given": { label: "Peer · given", className: "bg-warning/15 text-warning" },
    "peer-received": { label: "Peer · received", className: "bg-success/15 text-success" },
  } as const;
  const m = map[kind];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest",
        m.className
      )}
    >
      {m.label}
    </span>
  );
}

function EmptyHint({ text }: { text: string }) {
  return <p className="py-8 text-center text-sm text-muted-foreground">{text}</p>;
}
