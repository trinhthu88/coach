import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Star, TrendingUp, Award, Users, MessagesSquare } from "lucide-react";
import { AdminPageHeader, Kpi, SectionCard, MiniBar, Pill } from "./_shared";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Tables } from "@/integrations/supabase/types";

type CompetencyKey =
  | "ethical_practice"
  | "coaching_mindset"
  | "maintains_agreements"
  | "trust_safety"
  | "maintains_presence"
  | "listens_actively"
  | "evokes_awareness"
  | "facilitates_growth";

const COMPETENCY_LABELS: { key: CompetencyKey; label: string }[] = [
  { key: "ethical_practice", label: "Demonstrates ethical practice" },
  { key: "coaching_mindset", label: "Embodies coaching mindset" },
  { key: "maintains_agreements", label: "Establishes & maintains agreements" },
  { key: "trust_safety", label: "Cultivates trust & safety" },
  { key: "maintains_presence", label: "Maintains presence" },
  { key: "listens_actively", label: "Listens actively" },
  { key: "evokes_awareness", label: "Evokes awareness" },
  { key: "facilitates_growth", label: "Facilitates client growth" },
];

interface AnalyticsProfileRow {
  id: string;
  full_name: string | null;
  status: string;
}

interface AnalyticsCoachProfileRow {
  id: string;
  rating_avg: number | null;
  peer_coaching_opt_in: boolean | null;
}

interface AnalyticsSessionRow {
  coach_id: string;
  coachee_id: string;
  status: string;
  duration_minutes: number | null;
  coachee_rating: number | null;
}

interface AnalyticsPeerSessionRow {
  peer_coach_id: string;
  peer_coachee_id: string;
  status: string;
  duration_minutes: number | null;
}

interface AnalyticsEnrollmentRow {
  coachee_id: string;
  status: string;
  progress_pct: number | null;
}

interface AnalyticsData {
  platform: {
    sessTotal: number;
    peerTotal: number;
    totalHours: number;
    avgRating: number;
    dist: number[];
    totalCoachees: number;
    totalCoaches: number;
    peerOptIns: number;
  };
  coachee: { active: number; enrolled: number; progressAvg: number; atRisk: number; totalSessions: number };
  coach: { topCoaches: { id: string; name: string; delivered: number; coachees: number; rating: number }[] };
  peer: {
    rows: { id: string; name: string; given: number; received: number; avgComp: number }[];
    totalSessions: number;
    totalFeedback: number;
  };
  compAvg: Record<string, number>;
}

export default function AdminAnalytics() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<AnalyticsData | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [
        { data: roles },
        { data: profiles },
        { data: cps },
        { data: sess },
        { data: peer },
        { data: comp },
        { data: enr },
      ] = await Promise.all([
        supabase.from("user_roles").select("user_id, role"),
        supabase.from("profiles").select("id, full_name, status"),
        supabase.from("coach_profiles").select("id, rating_avg, peer_coaching_opt_in"),
        supabase.from("sessions").select("coach_id, coachee_id, status, duration_minutes, coachee_rating"),
        supabase.from("peer_sessions").select("peer_coach_id, peer_coachee_id, status, duration_minutes"),
        supabase.from("peer_session_competency_feedback").select("*"),
        supabase.from("programme_enrollments").select("coachee_id, status, progress_pct"),
      ]);

      const profById = new Map((profiles || []).map((p: AnalyticsProfileRow) => [p.id, p]));
      const cpById = new Map((cps || []).map((c: AnalyticsCoachProfileRow) => [c.id, c]));
      const coachIds = (roles || []).filter(r => r.role === "coach").map(r => r.user_id);
      const coacheeIds = (roles || []).filter(r => r.role === "coachee").map(r => r.user_id);

      // Platform KPIs
      const sessTotal = (sess || []).filter((s: AnalyticsSessionRow) => s.status === "completed").length;
      const peerTotal = (peer || []).filter((s: AnalyticsPeerSessionRow) => s.status === "completed").length;
      const ratings = (sess || []).map((s: AnalyticsSessionRow) => s.coachee_rating).filter((r): r is number => r != null);
      const avgRating = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0;
      const dist = [0, 0, 0, 0, 0];
      ratings.forEach((r) => { if (r >= 1 && r <= 5) dist[r - 1]++; });
      const totalHours = [...(sess || []), ...(peer || [])]
        .filter((s: AnalyticsSessionRow | AnalyticsPeerSessionRow) => s.status === "completed")
        .reduce((a: number, s: AnalyticsSessionRow | AnalyticsPeerSessionRow) => a + (s.duration_minutes || 0) / 60, 0);

      // Coachee analytics
      const coacheeSessDone = new Map<string, number>();
      const coacheeSessBooked = new Map<string, number>();
      (sess || []).forEach((s: AnalyticsSessionRow) => {
        if (s.status === "completed") coacheeSessDone.set(s.coachee_id, (coacheeSessDone.get(s.coachee_id) || 0) + 1);
        if (["pending_coach_approval", "confirmed"].includes(s.status)) coacheeSessBooked.set(s.coachee_id, (coacheeSessBooked.get(s.coachee_id) || 0) + 1);
      });
      const enrByCoachee = new Map<string, AnalyticsEnrollmentRow>();
      (enr || []).forEach((e: AnalyticsEnrollmentRow) => enrByCoachee.set(e.coachee_id, e));
      const activeCoachees = coacheeIds.filter(id => profById.get(id)?.status === "active").length;
      const enrolled = coacheeIds.filter(id => enrByCoachee.has(id)).length;
      const progressAvg = (() => {
        const vals = coacheeIds.map(id => (enrByCoachee.get(id)?.progress_pct ?? 0));
        return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
      })();
      const atRisk = (enr || []).filter((e: AnalyticsEnrollmentRow) => e.status === "at_risk").length;

      // Coach analytics (delivered)
      const coachDelivered = new Map<string, number>();
      const coachUnique = new Map<string, Set<string>>();
      (sess || []).forEach((s: AnalyticsSessionRow) => {
        if (s.status === "completed") coachDelivered.set(s.coach_id, (coachDelivered.get(s.coach_id) || 0) + 1);
        if (["confirmed", "completed"].includes(s.status)) {
          const set = coachUnique.get(s.coach_id) || new Set();
          set.add(s.coachee_id);
          coachUnique.set(s.coach_id, set);
        }
      });
      const topCoaches = coachIds.map(id => {
        const p = profById.get(id);
        const cp = cpById.get(id);
        return {
          id, name: p?.full_name || "—",
          delivered: coachDelivered.get(id) || 0,
          coachees: (coachUnique.get(id) || new Set()).size,
          rating: Number(cp?.rating_avg || 0),
        };
      }).sort((a, b) => b.delivered - a.delivered).slice(0, 10);

      // Peer analytics — only opt-ins
      const peerCoaches = coachIds.filter(id => cpById.get(id)?.peer_coaching_opt_in);
      const peerGiven = new Map<string, number>();
      const peerReceived = new Map<string, number>();
      (peer || []).forEach((s: AnalyticsPeerSessionRow) => {
        if (s.status === "completed") {
          peerGiven.set(s.peer_coach_id, (peerGiven.get(s.peer_coach_id) || 0) + 1);
          peerReceived.set(s.peer_coachee_id, (peerReceived.get(s.peer_coachee_id) || 0) + 1);
        }
      });
      // Per-peer-coach competency averages (received as peer-coach)
      const peerCompByCoach = new Map<string, { sums: Record<string, number>; counts: Record<string, number> }>();
      (comp || []).forEach((r: Tables<"peer_session_competency_feedback">) => {
        const acc = peerCompByCoach.get(r.peer_coach_id) || { sums: {}, counts: {} };
        COMPETENCY_LABELS.forEach(c => {
          const value = r[c.key];
          if (value != null) {
            acc.sums[c.key] = (acc.sums[c.key] || 0) + value;
            acc.counts[c.key] = (acc.counts[c.key] || 0) + 1;
          }
        });
        peerCompByCoach.set(r.peer_coach_id, acc);
      });
      const peerRows = peerCoaches.map(id => {
        const acc = peerCompByCoach.get(id);
        const avg = acc ? COMPETENCY_LABELS.reduce((a, c) => a + ((acc.sums[c.key] || 0) / (acc.counts[c.key] || 1)), 0) / COMPETENCY_LABELS.length : 0;
        return {
          id, name: profById.get(id)?.full_name || "—",
          given: peerGiven.get(id) || 0,
          received: peerReceived.get(id) || 0,
          avgComp: avg,
        };
      }).sort((a, b) => b.given - a.given);

      // Aggregate competency averages (platform)
      const aggSums: Record<string, number> = {};
      const aggCounts: Record<string, number> = {};
      (comp || []).forEach((r: Tables<"peer_session_competency_feedback">) => {
        COMPETENCY_LABELS.forEach(c => {
          const value = r[c.key];
          if (value != null) {
            aggSums[c.key] = (aggSums[c.key] || 0) + value;
            aggCounts[c.key] = (aggCounts[c.key] || 0) + 1;
          }
        });
      });
      const compAvg: Record<string, number> = {};
      Object.keys(aggSums).forEach(k => { compAvg[k] = aggSums[k] / aggCounts[k]; });

      setData({
        platform: { sessTotal, peerTotal, totalHours, avgRating, dist, totalCoachees: coacheeIds.length, totalCoaches: coachIds.length, peerOptIns: peerCoaches.length },
        coachee: { active: activeCoachees, enrolled, progressAvg, atRisk, totalSessions: sessTotal },
        coach: { topCoaches },
        peer: { rows: peerRows, totalSessions: peerTotal, totalFeedback: (comp || []).length },
        compAvg,
      });
      setLoading(false);
    })();
  }, []);

  if (loading || !data) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  const totalRatings = data.platform.dist.reduce((a: number, b: number) => a + b, 0);

  return (
    <div>
      <AdminPageHeader eyebrow="Organisation" title="Platform" emphasize="analytics" subtitle="Performance, satisfaction and competency insights." />

      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Kpi label="Coaching sessions" value={data.platform.sessTotal} icon={Award} tone="primary" />
        <Kpi label="Peer sessions" value={data.platform.peerTotal} icon={MessagesSquare} tone="accent" />
        <Kpi label="Total hours" value={data.platform.totalHours.toFixed(0)} icon={TrendingUp} tone="success" />
        <Kpi label="Avg rating" value={data.platform.avgRating ? data.platform.avgRating.toFixed(2) : "—"} icon={Star} tone="warning" />
      </div>

      <Tabs defaultValue="platform">
        <TabsList>
          <TabsTrigger value="platform">Platform</TabsTrigger>
          <TabsTrigger value="coachee">Coachees</TabsTrigger>
          <TabsTrigger value="coach">Coaches</TabsTrigger>
          <TabsTrigger value="peer">Peer coaching</TabsTrigger>
        </TabsList>

        <TabsContent value="platform" className="space-y-3 pt-4">
          <div className="grid gap-3 lg:grid-cols-2">
            <SectionCard label="Satisfaction distribution">
              {totalRatings === 0 ? <p className="py-6 text-center text-xs text-muted-foreground">No ratings yet.</p> : (
                <div className="space-y-2">
                  {[5, 4, 3, 2, 1].map((star) => {
                    const count = data.platform.dist[star - 1];
                    const pct = (count / totalRatings) * 100;
                    return (
                      <div key={star} className="flex flex-col gap-1 sm:grid sm:grid-cols-12 sm:items-center sm:gap-2">
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium sm:col-span-2"><Star className="h-3 w-3 fill-warning text-warning" /> {star}</span>
                        <div className="sm:col-span-8"><MiniBar pct={pct} tone={star >= 4 ? "success" : star === 3 ? "primary" : "warning"} /></div>
                        <span className="text-[11px] text-muted-foreground sm:col-span-2 sm:text-right">{count}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </SectionCard>
            <SectionCard label="ICF competency averages (peer feedback)">
              {Object.keys(data.compAvg).length === 0 ? <p className="py-6 text-center text-xs text-muted-foreground">No competency feedback yet.</p> : (
                <div className="space-y-2.5">
                  {COMPETENCY_LABELS.map(c => {
                    const v = data.compAvg[c.key] || 0;
                    return (
                      <div key={c.key} className="flex flex-col gap-1 sm:grid sm:grid-cols-12 sm:items-center sm:gap-2">
                        <span className="text-[11px] text-muted-foreground sm:col-span-6">{c.label}</span>
                        <div className="sm:col-span-5"><MiniBar pct={v} tone={v >= 70 ? "success" : v >= 50 ? "primary" : "warning"} /></div>
                        <span className="text-[11px] font-semibold sm:col-span-1 sm:text-right">{Math.round(v)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </SectionCard>
          </div>
        </TabsContent>

        <TabsContent value="coachee" className="space-y-3 pt-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <Kpi label="Total coachees" value={data.platform.totalCoachees} icon={Users} tone="primary" />
            <Kpi label="Active" value={data.coachee.active} icon={Users} tone="success" />
            <Kpi label="Enrolled in programme" value={data.coachee.enrolled} icon={Award} tone="accent" />
            <Kpi label="At risk" value={data.coachee.atRisk} icon={Users} tone="destructive" />
          </div>
          <SectionCard label="Average programme progress">
            <div className="flex items-center gap-3">
              <div className="flex-1"><MiniBar pct={data.coachee.progressAvg} tone={data.coachee.progressAvg >= 70 ? "success" : "primary"} /></div>
              <span className="text-sm font-semibold">{Math.round(data.coachee.progressAvg)}%</span>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">Average across all enrolled coachees.</p>
          </SectionCard>
        </TabsContent>

        <TabsContent value="coach" className="space-y-3 pt-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Kpi label="Total coaches" value={data.platform.totalCoaches} icon={Users} tone="primary" />
            <Kpi label="Sessions delivered" value={data.platform.sessTotal} icon={Award} tone="success" />
            <Kpi label="Avg rating" value={data.platform.avgRating ? data.platform.avgRating.toFixed(2) : "—"} icon={Star} tone="warning" />
          </div>
          <SectionCard label="Top coaches by sessions delivered">
            {data.coach.topCoaches.length === 0 ? <p className="py-6 text-center text-xs text-muted-foreground">No data yet.</p> : (
              <div className="divide-y">
                {data.coach.topCoaches.map((c) => (
                  <div key={c.id} className="flex flex-col gap-1 py-2 text-[12px] sm:grid sm:grid-cols-12 sm:items-center sm:gap-2">
                    <span className="font-medium sm:col-span-5">{c.name}</span>
                    <span className="text-muted-foreground sm:col-span-3">{c.coachees} coachees</span>
                    <span className="text-muted-foreground sm:col-span-2">{c.delivered} sessions</span>
                    <span className="inline-flex items-center gap-1 text-muted-foreground sm:col-span-2 sm:justify-end sm:text-right"><Star className="h-3 w-3 fill-warning text-warning" /> {c.rating.toFixed(1)}</span>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </TabsContent>

        <TabsContent value="peer" className="space-y-3 pt-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Kpi label="Coaches in peer pool" value={data.platform.peerOptIns} icon={Users} tone="primary" />
            <Kpi label="Peer sessions completed" value={data.peer.totalSessions} icon={MessagesSquare} tone="accent" />
            <Kpi label="Competency feedback" value={data.peer.totalFeedback} icon={Award} tone="success" />
          </div>
          <SectionCard label="Peer-coaching trainees — competencies & activity">
            {data.peer.rows.length === 0 ? <p className="py-6 text-center text-xs text-muted-foreground">No peer-coaching coaches yet.</p> : (
              <div className="divide-y">
                {data.peer.rows.map((r) => (
                  <div key={r.id} className="flex flex-col gap-1.5 py-2 text-[12px] sm:grid sm:grid-cols-12 sm:items-center sm:gap-2">
                    <span className="font-medium sm:col-span-4">{r.name}</span>
                    <span className="text-muted-foreground sm:col-span-2">Given: {r.given}</span>
                    <span className="text-muted-foreground sm:col-span-2">Received: {r.received}</span>
                    <div className="sm:col-span-3"><MiniBar pct={r.avgComp} tone={r.avgComp >= 70 ? "success" : r.avgComp >= 50 ? "primary" : "warning"} /></div>
                    <span className="sm:col-span-1 sm:text-right">
                      <Pill tone={r.avgComp >= 70 ? "success" : r.avgComp >= 50 ? "primary" : "warning"}>{Math.round(r.avgComp)}</Pill>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </TabsContent>
      </Tabs>
    </div>
  );
}
