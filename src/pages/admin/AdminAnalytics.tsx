import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { AdminPageHeader, Kpi, SectionCard, MiniBar } from "./_shared";
import { Star, TrendingUp, Smile, Award } from "lucide-react";

const COMPETENCY_LABELS: { key: string; label: string }[] = [
  { key: "ethical_practice", label: "Demonstrates ethical practice" },
  { key: "coaching_mindset", label: "Embodies coaching mindset" },
  { key: "maintains_agreements", label: "Establishes & maintains agreements" },
  { key: "trust_safety", label: "Cultivates trust & safety" },
  { key: "maintains_presence", label: "Maintains presence" },
  { key: "listens_actively", label: "Listens actively" },
  { key: "evokes_awareness", label: "Evokes awareness" },
  { key: "facilitates_growth", label: "Facilitates client growth" },
];

export default function AdminAnalytics() {
  const [loading, setLoading] = useState(true);
  const [comp, setComp] = useState<Record<string, number>>({});
  const [satisfaction, setSatisfaction] = useState({ avg: 0, dist: [0, 0, 0, 0, 0] });
  const [usage, setUsage] = useState({ totalSessions: 0, totalPeer: 0, hours: 0 });

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [{ data: comp }, { data: sess }, { data: peer }] = await Promise.all([
        supabase.from("peer_session_competency_feedback").select("*"),
        supabase.from("sessions").select("status, duration_minutes, coachee_rating"),
        supabase.from("peer_sessions").select("status, duration_minutes"),
      ]);

      // Competency averages
      const sums: Record<string, number> = {};
      const counts: Record<string, number> = {};
      (comp || []).forEach((r: any) => {
        COMPETENCY_LABELS.forEach((c) => {
          if (r[c.key] != null) {
            sums[c.key] = (sums[c.key] || 0) + r[c.key];
            counts[c.key] = (counts[c.key] || 0) + 1;
          }
        });
      });
      const avgComp: Record<string, number> = {};
      Object.keys(sums).forEach((k) => { avgComp[k] = sums[k] / counts[k]; });
      setComp(avgComp);

      // Satisfaction
      const ratings = (sess || []).map((s: any) => s.coachee_rating).filter((r: any) => r);
      const avg = ratings.length ? ratings.reduce((a: number, b: number) => a + b, 0) / ratings.length : 0;
      const dist = [0, 0, 0, 0, 0];
      ratings.forEach((r: number) => { if (r >= 1 && r <= 5) dist[r - 1]++; });
      setSatisfaction({ avg, dist });

      const totalSessions = (sess || []).filter((s: any) => s.status === "completed").length;
      const totalPeer = (peer || []).filter((s: any) => s.status === "completed").length;
      const hours = (sess || []).filter((s: any) => s.status === "completed").reduce((a: number, s: any) => a + (s.duration_minutes || 0) / 60, 0)
        + (peer || []).filter((s: any) => s.status === "completed").reduce((a: number, s: any) => a + (s.duration_minutes || 0) / 60, 0);
      setUsage({ totalSessions, totalPeer, hours });
      setLoading(false);
    })();
  }, []);

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  const totalRatings = satisfaction.dist.reduce((a, b) => a + b, 0);

  return (
    <div>
      <AdminPageHeader title="Platform" emphasize="analytics" subtitle="Competency, satisfaction and usage trends." />

      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Kpi label="Coaching sessions" value={usage.totalSessions} icon={Award} tone="primary" />
        <Kpi label="Peer sessions" value={usage.totalPeer} icon={Award} tone="accent" />
        <Kpi label="Total hours" value={usage.hours.toFixed(0)} icon={TrendingUp} tone="success" />
        <Kpi label="Avg rating" value={satisfaction.avg ? satisfaction.avg.toFixed(2) : "—"} icon={Star} tone="warning" />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <SectionCard label="Competency averages (peer feedback)">
          {Object.keys(comp).length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">No competency feedback yet.</p>
          ) : (
            <div className="space-y-2.5">
              {COMPETENCY_LABELS.map((c) => {
                const v = comp[c.key] || 0;
                return (
                  <div key={c.key} className="grid grid-cols-12 items-center gap-2">
                    <span className="col-span-6 text-[11px] text-muted-foreground">{c.label}</span>
                    <div className="col-span-5"><MiniBar pct={v} tone={v >= 70 ? "success" : v >= 50 ? "primary" : "warning"} /></div>
                    <span className="col-span-1 text-right text-[11px] font-semibold">{Math.round(v)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </SectionCard>

        <SectionCard label="Satisfaction distribution">
          {totalRatings === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">No ratings yet.</p>
          ) : (
            <div className="space-y-2">
              {[5, 4, 3, 2, 1].map((star) => {
                const count = satisfaction.dist[star - 1];
                const pct = (count / totalRatings) * 100;
                return (
                  <div key={star} className="grid grid-cols-12 items-center gap-2">
                    <span className="col-span-2 inline-flex items-center gap-1 text-[11px] font-medium"><Star className="h-3 w-3 fill-warning text-warning" /> {star}</span>
                    <div className="col-span-8"><MiniBar pct={pct} tone={star >= 4 ? "success" : star === 3 ? "primary" : "warning"} /></div>
                    <span className="col-span-2 text-right text-[11px] text-muted-foreground">{count}</span>
                  </div>
                );
              })}
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
