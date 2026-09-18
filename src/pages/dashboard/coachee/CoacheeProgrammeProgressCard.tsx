import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { useEnrollmentContext } from "@/hooks/useEnrollmentContext";
import { useLearnerCanonicalProgress } from "@/hooks/useLearnerCanonicalProgress";
import { Card } from "@/components/ui/card";

/**
 * Programme progress — the four canonical stats from learner_canonical_progress,
 * unaggregated further: overall completion, due adherence, due/required units
 * and overdue units. Same engine as CoacheeProgrammeHero / ProgrammeProgressCard;
 * never recomputed here.
 */
export function CoacheeProgrammeProgressCard() {
  const { t } = useTranslation("dashboard");
  const { user } = useAuth();
  const { selectedEnrollment, loading: enrollmentLoading } = useEnrollmentContext(user?.id);
  const enrollmentId = selectedEnrollment?.id;
  const { progress, loading: progressLoading } = useLearnerCanonicalProgress(enrollmentId);
  const loading = enrollmentLoading || progressLoading;

  return (
    <Card className="p-5">
      <p className="font-display text-lg">{t("coacheeDashboard.progress.title")}</p>
      <p className="mt-0.5 text-[11.5px] text-muted-foreground">{t("coacheeDashboard.progress.subtitle")}</p>

      {loading ? (
        <div className="mt-4 h-20 animate-pulse rounded-xl bg-muted/50" />
      ) : !progress ? (
        <p className="mt-4 text-sm text-muted-foreground">{t("coacheeDashboard.progress.enrollmentRequired")}</p>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Stat value={`${Math.round(progress.full_completion_pct)}%`} label={t("coacheeDashboard.progress.overall")} />
          <Stat
            value={progress.due_adherence_pct != null ? `${Math.round(progress.due_adherence_pct)}%` : "—"}
            label={t("coacheeDashboard.progress.dueAdherence")}
          />
          <Stat
            value={`${progress.completed_units}/${progress.due_units}`}
            label={t("coacheeDashboard.progress.activitiesDue")}
          />
          <Stat value={String(progress.overdue_units)} label={t("coacheeDashboard.progress.overdue")} tone={progress.overdue_units > 0 ? "destructive" : undefined} />
        </div>
      )}

      <Link to="/coachee/journey" className="mt-4 inline-block text-[11.5px] font-semibold text-primary hover:underline">
        {t("coacheeDashboard.progress.viewFullJourney")}
      </Link>
    </Card>
  );
}

function Stat({ value, label, tone }: { value: string; label: string; tone?: "destructive" }) {
  return (
    <div>
      <p className={`font-display text-2xl ${tone === "destructive" ? "text-destructive" : ""}`}>{value}</p>
      <p className="mt-1 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
    </div>
  );
}
