import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import { GraduationCap } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/context/AuthContext";
import { useProgrammeModules } from "@/hooks/useProgrammeModules";
import { useProgrammeProgress } from "@/hooks/dashboard/useProgrammeProgress";

/**
 * "My Programme Progress" dashboard widget — shared between the coach and
 * coachee dashboards, same "renders nothing while loading / when the module
 * is off" contract as ThisWeekSkillCard/DailyPromptCard. Gated on
 * hasModule('training') because get_my_training_weeks() (which everything
 * here hangs off) already returns nothing without it; the quiz/triad/daily
 * prompt sub-sections each additionally check their own module.
 */
export function ProgrammeProgressCard() {
  const { t } = useTranslation("training");
  const { user } = useAuth();
  const { hasModule, loading: modulesLoading } = useProgrammeModules();
  const { summary, loading } = useProgrammeProgress(user?.id);

  if (modulesLoading || !hasModule("training")) return null;

  if (loading) {
    return (
      <Card className="p-5">
        <div className="h-24 animate-pulse rounded-lg bg-muted/50" />
      </Card>
    );
  }

  if (summary.weeksTotal === 0) return null;

  const showQuiz = hasModule("quiz") && summary.quizScores.length > 0;
  const showTriads = hasModule("triads");
  const showStreak = hasModule("daily_prompt");
  const showConfidence = hasModule("daily_prompt") && summary.confidenceTrend.length > 1;

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-2">
        <GraduationCap className="h-4 w-4 text-primary" />
        <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{t("progressCard.eyebrow")}</p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label={t("progressCard.skillsCompleted")} value={`${summary.weeksCompleted}/${summary.weeksTotal}`} />
        {showStreak && <Stat label={t("progressCard.reflectionStreak")} value={String(summary.reflectionStreak)} />}
        {showQuiz && <Stat label={t("progressCard.quizAvg")} value={summary.quizAvg != null ? `${Math.round(summary.quizAvg)}%` : "—"} />}
        {showTriads && (
          <Stat
            label={t("progressCard.triadSessions")}
            value={String(summary.triadCompletedCount)}
            hint={
              summary.nextTriadDate
                ? t("progressCard.nextTriadOn", { date: format(new Date(summary.nextTriadDate), "MMM d") })
                : t("progressCard.noTriadScheduled")
            }
          />
        )}
      </div>

      {showQuiz && (
        <div className="mt-4 border-t pt-4">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{t("progressCard.quizScoresPerWeek")}</p>
          <div className="flex flex-wrap gap-2">
            {summary.quizScores.map((q) => (
              <span key={q.weekNumber} className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium">
                {t("progressCard.weekScorePill", { n: q.weekNumber, score: Math.round(q.scorePct) })}
              </span>
            ))}
          </div>
        </div>
      )}

      {showConfidence && (
        <div className="mt-4 border-t pt-4">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{t("progressCard.confidenceTrend")}</p>
          <div className="h-32">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={summary.confidenceTrend} margin={{ top: 4, right: 8, bottom: 0, left: -24 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 9 }} />
                <YAxis domain={[0, 10]} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 9 }} />
                <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 11 }} />
                <Line type="monotone" dataKey="score" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 2 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </Card>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="font-display mt-1 text-2xl font-normal leading-none">{value}</p>
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
