import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fetchAdminCompletionRate } from "@/lib/adminCanonicalProgress";
import { Loader2, Star, TrendingUp, Award, Users, MessagesSquare, Flag } from "lucide-react";
import { cn } from "@/lib/utils";
import { AdminPageHeader, Kpi, SectionCard, MiniBar, Pill, Avatar, EngagementCell } from "./_shared";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAdminProgrammes, useAdminProgrammeEngagement } from "@/hooks/admin/useAdminProgrammeEngagement";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

type CompetencyKey =
  | "ethical_practice"
  | "coaching_mindset"
  | "maintains_agreements"
  | "trust_safety"
  | "maintains_presence"
  | "listens_actively"
  | "evokes_awareness"
  | "facilitates_growth";

const COMPETENCY_LABELS: { key: CompetencyKey }[] = [
  { key: "ethical_practice" },
  { key: "coaching_mindset" },
  { key: "maintains_agreements" },
  { key: "trust_safety" },
  { key: "maintains_presence" },
  { key: "listens_actively" },
  { key: "evokes_awareness" },
  { key: "facilitates_growth" },
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

/** admin_analytics_summary() (20261007001100). */
interface AnalyticsSummary {
  coaching_sessions: number;
  mentoring_sessions: number;
  peer_units: number;
  practice_sessions: number;
  total_minutes: number;
  learners_enrolled: number;
  at_risk: number;
  satisfaction: { average: number | null; rated: number; distribution: number[] };
  top_coaches: { coach_id: string; name: string | null; delivered: number; coachees: number; rating: number | null }[];
  practice_by_coach: { coach_id: string; name: string | null; given: number; received: number; avg_competency: number | null }[];
  practice_feedback_count: number;
  competency_avg: Record<string, number>;
}

interface AnalyticsData {
  platform: {
    sessTotal: number;
    /** Canonical Peer units (dyad sessions, one per learner and requirement). */
    peerTotal: number;
    /** Coach-pool practice: earns no unit, shown apart. */
    practiceTotal: number;
    totalHours: number;
    /** Canonical 1-5 satisfaction average over all four modules; null when nothing is rated. */
    avgRating: number | null;
    dist: number[];
    totalCoachees: number;
    totalCoaches: number;
    peerOptIns: number;
  };
  coachee: { active: number; enrolled: number; progressAvg: number | null; atRisk: number; totalSessions: number };
  coach: { topCoaches: { id: string; name: string; delivered: number; coachees: number; rating: number | null }[] };
  peer: {
    rows: { id: string; name: string; given: number; received: number; avgComp: number }[];
    totalSessions: number;
    totalFeedback: number;
  };
  compAvg: Record<string, number>;
}

export default function AdminAnalytics() {
  const { t } = useTranslation("admin");
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<AnalyticsData | null>(null);
  const programmes = useAdminProgrammes();
  const [selectedProgrammeId, setSelectedProgrammeId] = useState<string>("");
  const { weeks: engagementWeeks, redFlags, loading: engagementLoading } = useAdminProgrammeEngagement(selectedProgrammeId || null);
  const [flaggedIds, setFlaggedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!selectedProgrammeId && programmes.length > 0) setSelectedProgrammeId(programmes[0].id);
  }, [programmes, selectedProgrammeId]);

  const flagParticipant = async (userId: string, enrollmentId: string, fullName: string) => {
    const { data: existing } = await supabase
      .from("admin_alerts")
      .select("id")
      .eq("alert_type", "stale_programme_participant")
      .eq("related_enrollment_id", enrollmentId)
      .eq("resolved", false)
      .maybeSingle();
    if (existing) {
      toast.info(t("analytics.programmeEngagement.alreadyFlagged"));
      return;
    }
    const { error } = await supabase.from("admin_alerts").insert({
      severity: "warning",
      alert_type: "stale_programme_participant",
      title: `${fullName} — no programme activity in 7+ days`,
      message: `${fullName} hasn't completed a training week, quiz, reflection, triad reflection, or daily prompt in over a week.`,
      related_coachee_id: userId,
      related_enrollment_id: enrollmentId,
      resolved: false,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    setFlaggedIds((prev) => new Set(prev).add(enrollmentId));
    toast.success(t("analytics.programmeEngagement.flagged"));
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      // Every session, hour, at-risk and satisfaction number is the server's
      // (admin_analytics_summary, 20261007001100): held sessions over the
      // reporting population, Peer in canonical units, coach-pool practice
      // apart, at risk by the Sponsor rule. Account counts stay here.
      const [{ data: roles }, { data: profiles }, { data: cps }, summaryRes, progressAvg] = await Promise.all([
        supabase.from("user_roles").select("user_id, role"),
        supabase.from("profiles").select("id, full_name, status"),
        supabase.from("coach_profiles").select("id, rating_avg, peer_coaching_opt_in"),
        supabase.rpc("admin_analytics_summary"),
        fetchAdminCompletionRate(),
      ]);
      if (summaryRes.error) {
        toast.error(summaryRes.error.message);
        setLoading(false);
        return;
      }
      const summary = summaryRes.data as unknown as AnalyticsSummary;
      const profById = new Map((profiles || []).map((p: AnalyticsProfileRow) => [p.id, p]));
      const coachIds = (roles || []).filter(r => r.role === "coach").map(r => r.user_id);
      const coacheeIds = (roles || []).filter(r => r.role === "coachee").map(r => r.user_id);
      const peerOptIns = (cps || []).filter((c: AnalyticsCoachProfileRow) => c.peer_coaching_opt_in).length;

      setData({
        platform: {
          sessTotal: summary.coaching_sessions,
          peerTotal: summary.peer_units,
          practiceTotal: summary.practice_sessions,
          totalHours: summary.total_minutes / 60,
          avgRating: summary.satisfaction.average,
          dist: summary.satisfaction.distribution,
          totalCoachees: coacheeIds.length,
          totalCoaches: coachIds.length,
          peerOptIns,
        },
        coachee: {
          active: coacheeIds.filter(id => profById.get(id)?.status === "active").length,
          enrolled: summary.learners_enrolled,
          progressAvg,
          atRisk: summary.at_risk,
          totalSessions: summary.coaching_sessions,
        },
        coach: {
          topCoaches: summary.top_coaches.map((c) => ({
            id: c.coach_id, name: c.name || "—", delivered: c.delivered, coachees: c.coachees,
            rating: c.rating == null ? null : Number(c.rating),
          })),
        },
        peer: {
          rows: summary.practice_by_coach.map((r) => ({
            id: r.coach_id, name: r.name || "—", given: r.given, received: r.received, avgComp: r.avg_competency ?? 0,
          })),
          totalSessions: summary.practice_sessions,
          totalFeedback: summary.practice_feedback_count,
        },
        compAvg: summary.competency_avg,
      });
      setLoading(false);
    })();
  }, []);

  if (loading || !data) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  const totalRatings = data.platform.dist.reduce((a: number, b: number) => a + b, 0);

  return (
    <div>
      <AdminPageHeader eyebrow={t("analytics.eyebrow")} title={t("analytics.title")} emphasize={t("analytics.titleEmphasis")} subtitle={t("analytics.subtitle")} />

      <div className="mb-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Kpi label={t("analytics.coachingSessions")} value={data.platform.sessTotal} icon={Award} tone="primary" />
        <Kpi label={t("analytics.peerSessions")} value={data.platform.peerTotal} icon={MessagesSquare} tone="accent" />
        <Kpi label={t("analytics.practiceSessions")} value={data.platform.practiceTotal} icon={MessagesSquare} tone="accent" />
        <Kpi label={t("analytics.totalHours")} value={data.platform.totalHours.toFixed(0)} icon={TrendingUp} tone="success" />
        <Kpi label={t("analytics.avgRating")} value={data.platform.avgRating == null ? "—" : data.platform.avgRating.toFixed(2)} icon={Star} tone="warning" />
      </div>

      <Tabs defaultValue="platform">
        <TabsList>
          <TabsTrigger value="platform">{t("analytics.tabs.platform")}</TabsTrigger>
          <TabsTrigger value="coachee">{t("analytics.tabs.coachees")}</TabsTrigger>
          <TabsTrigger value="coach">{t("analytics.tabs.coaches")}</TabsTrigger>
          <TabsTrigger value="peer">{t("analytics.tabs.peerCoaching")}</TabsTrigger>
          <TabsTrigger value="programmeEngagement">{t("analytics.tabs.programmeEngagement")}</TabsTrigger>
        </TabsList>

        <TabsContent value="platform" className="space-y-3 pt-4">
          <div className="grid gap-3 lg:grid-cols-2">
            <SectionCard label={t("analytics.satisfactionDistribution")}>
              {totalRatings === 0 ? <p className="py-6 text-center text-xs text-muted-foreground">{t("analytics.noRatingsYet")}</p> : (
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
            <SectionCard label={t("analytics.icfCompetencyAverages")}>
              {Object.keys(data.compAvg).length === 0 ? <p className="py-6 text-center text-xs text-muted-foreground">{t("analytics.noCompetencyFeedbackYet")}</p> : (
                <div className="space-y-2.5">
                  {COMPETENCY_LABELS.map(c => {
                    const v = data.compAvg[c.key] || 0;
                    return (
                      <div key={c.key} className="flex flex-col gap-1 sm:grid sm:grid-cols-12 sm:items-center sm:gap-2">
                        <span className="text-[11px] text-muted-foreground sm:col-span-6">{t(`analytics.competencies.${c.key}`)}</span>
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
            <Kpi label={t("analytics.totalCoachees")} value={data.platform.totalCoachees} icon={Users} tone="primary" />
            <Kpi label={t("analytics.active")} value={data.coachee.active} icon={Users} tone="success" />
            <Kpi label={t("analytics.enrolledInProgramme")} value={data.coachee.enrolled} icon={Award} tone="accent" />
            <Kpi label={t("analytics.atRisk")} value={data.coachee.atRisk} icon={Users} tone="destructive" />
          </div>
          <SectionCard label={t("analytics.averageProgrammeProgress")}>
            <div className="flex items-center gap-3">
              <div className="flex-1"><MiniBar pct={data.coachee.progressAvg ?? 0} tone={(data.coachee.progressAvg ?? 0) >= 70 ? "success" : "primary"} /></div>
              <span className="text-sm font-semibold">{data.coachee.progressAvg == null ? "—" : `${data.coachee.progressAvg}%`}</span>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">{t("analytics.averageAcrossEnrolled")}</p>
          </SectionCard>
        </TabsContent>

        <TabsContent value="coach" className="space-y-3 pt-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Kpi label={t("analytics.totalCoaches")} value={data.platform.totalCoaches} icon={Users} tone="primary" />
            <Kpi label={t("analytics.sessionsDelivered")} value={data.platform.sessTotal} icon={Award} tone="success" />
            <Kpi label={t("analytics.avgRating")} value={data.platform.avgRating == null ? "—" : data.platform.avgRating.toFixed(2)} icon={Star} tone="warning" />
          </div>
          <SectionCard label={t("analytics.topCoachesBySessions")}>
            {data.coach.topCoaches.length === 0 ? <p className="py-6 text-center text-xs text-muted-foreground">{t("analytics.noDataYet")}</p> : (
              <div className="divide-y">
                {data.coach.topCoaches.map((c) => (
                  <div key={c.id} className="flex flex-col gap-1 py-2 text-[12px] sm:grid sm:grid-cols-12 sm:items-center sm:gap-2">
                    <span className="font-medium sm:col-span-5">{c.name}</span>
                    <span className="text-muted-foreground sm:col-span-3">{t("analytics.coacheesCount", { count: c.coachees })}</span>
                    <span className="text-muted-foreground sm:col-span-2">{t("analytics.sessionsCount", { count: c.delivered })}</span>
                    <span className="inline-flex items-center gap-1 text-muted-foreground sm:col-span-2 sm:justify-end sm:text-right"><Star className="h-3 w-3 fill-warning text-warning" /> {c.rating == null ? "—" : c.rating.toFixed(1)}</span>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </TabsContent>

        <TabsContent value="peer" className="space-y-3 pt-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Kpi label={t("analytics.coachesInPeerPool")} value={data.platform.peerOptIns} icon={Users} tone="primary" />
            <Kpi label={t("analytics.peerSessionsCompleted")} value={data.peer.totalSessions} icon={MessagesSquare} tone="accent" />
            <Kpi label={t("analytics.competencyFeedback")} value={data.peer.totalFeedback} icon={Award} tone="success" />
          </div>
          <SectionCard label={t("analytics.peerCoachingTrainees")}>
            {data.peer.rows.length === 0 ? <p className="py-6 text-center text-xs text-muted-foreground">{t("analytics.noPeerCoachingCoachesYet")}</p> : (
              <div className="divide-y">
                {data.peer.rows.map((r) => (
                  <div key={r.id} className="flex flex-col gap-1.5 py-2 text-[12px] sm:grid sm:grid-cols-12 sm:items-center sm:gap-2">
                    <span className="font-medium sm:col-span-4">{r.name}</span>
                    <span className="text-muted-foreground sm:col-span-2">{t("analytics.given")}: {r.given}</span>
                    <span className="text-muted-foreground sm:col-span-2">{t("analytics.received")}: {r.received}</span>
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

        <TabsContent value="programmeEngagement" className="space-y-3 pt-4">
          <div className="max-w-xs">
            <Select value={selectedProgrammeId} onValueChange={setSelectedProgrammeId}>
              <SelectTrigger>
                <SelectValue placeholder={t("analytics.programmeEngagement.selectProgramme")} />
              </SelectTrigger>
              <SelectContent>
                {programmes.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {engagementLoading ? (
            <div className="flex h-48 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : engagementWeeks.length === 0 ? (
            <SectionCard label={t("analytics.programmeEngagement.perWeekLabel")}>
              <p className="py-6 text-center text-xs text-muted-foreground">{t("analytics.programmeEngagement.noData")}</p>
            </SectionCard>
          ) : (
            <>
              <SectionCard label={t("analytics.programmeEngagement.perWeekLabel")}>
                <div className="overflow-hidden rounded-xl border">
                  <div className="grid grid-cols-[64px_repeat(4,1fr)] gap-0 border-b bg-muted/40 px-3 py-2.5 text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground">
                    <span>{t("analytics.programmeEngagement.columns.week")}</span>
                    <span>{t("analytics.programmeEngagement.columns.skillCard")}</span>
                    <span>{t("analytics.programmeEngagement.columns.quiz")}</span>
                    <span>{t("analytics.programmeEngagement.columns.triad")}</span>
                    <span>{t("analytics.programmeEngagement.columns.prompt")}</span>
                  </div>
                  <div className="divide-y">
                    {engagementWeeks.map((w) => (
                      <div key={w.weekId} className="grid grid-cols-[64px_repeat(4,1fr)] items-center gap-0 px-3 py-3 text-[12.5px]">
                        <span className="truncate font-bold" title={`W${w.weekNumber} · ${w.title}`}>W{w.weekNumber}</span>
                        <EngagementCell pct={w.skillCardCompletionPct} />
                        <EngagementCell pct={w.quizCompletionPct} sub={w.quizAvgScore != null ? `${Math.round(w.quizAvgScore)}% avg` : undefined} />
                        <EngagementCell pct={w.triadReflectionPct} />
                        <EngagementCell pct={w.promptResponseRate} tone="accent" />
                      </div>
                    ))}
                  </div>
                </div>
              </SectionCard>

              <SectionCard label={t("analytics.programmeEngagement.completionFunnel")}>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={engagementWeeks.map((w) => ({ week: `W${w.weekNumber}`, completed: w.completedCount }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                      <XAxis dataKey="week" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
                      <YAxis allowDecimals={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
                      <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 11 }} />
                      <Bar dataKey="completed" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </SectionCard>

              <Card className={cn("p-5", redFlags.length > 0 && "border-l-4 border-l-accent")}>
                <p className="text-2xs font-bold uppercase tracking-[0.2em] text-accent">{t("analytics.programmeEngagement.redFlags")}</p>
                {redFlags.length === 0 ? (
                  <p className="py-6 text-center text-xs text-muted-foreground">{t("analytics.programmeEngagement.noRedFlags")}</p>
                ) : (
                  <div className="mt-3.5 divide-y">
                     {redFlags.map((f) => (
                       <div key={f.enrollmentId} className="flex flex-col gap-2 py-2.5 text-[12px] sm:flex-row sm:items-center sm:justify-between">
                        <span className="inline-flex items-center gap-2.5 font-medium">
                          <Avatar name={f.fullName} tone="accent" size={26} /> {f.fullName}
                        </span>
                        <div className="flex items-center gap-3">
                          <span className="text-muted-foreground">
                            {f.daysSinceLastActivity != null
                              ? t("analytics.programmeEngagement.daysInactive", { count: f.daysSinceLastActivity })
                              : t("analytics.programmeEngagement.noActivityYet")}
                          </span>
                          <Button
                            size="sm"
                            variant="outline"
                             disabled={flaggedIds.has(f.enrollmentId)}
                             onClick={() => flagParticipant(f.userId, f.enrollmentId, f.fullName)}
                          >
                            <Flag className="mr-1 h-3.5 w-3.5" />
                             {flaggedIds.has(f.enrollmentId) ? t("analytics.programmeEngagement.flaggedLabel") : t("analytics.programmeEngagement.flag")}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
