import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { useAuth } from "@/context/AuthContext";
import { useEnrollmentContext } from "@/hooks/useEnrollmentContext";
import { useLearnerFeedback } from "@/hooks/dashboard/useLearnerFeedback";
import { Card } from "@/components/ui/card";

/**
 * Feedback & development — same source as MyFeedbackCard
 * (mentoring_feedback + peer_session_competency_feedback via
 * useLearnerFeedback; coach_session_feedback is never queried here or
 * anywhere learner-facing), scoped to the selected enrollment.
 */
export function CoacheeFeedbackDevelopmentCard() {
  const { t } = useTranslation("dashboard");
  const { user } = useAuth();
  const { selectedEnrollment, loading: enrollmentLoading } = useEnrollmentContext(user?.id);
  const { feedback, loading, error } = useLearnerFeedback(user?.id, selectedEnrollment?.id);

  return (
    <Card className="p-5">
      <p className="font-display text-lg">{t("coacheeDashboard.feedbackDevelopment.title")}</p>
      <p className="mt-0.5 text-[11.5px] text-muted-foreground">{t("coacheeDashboard.feedbackDevelopment.subtitle")}</p>

      {loading || enrollmentLoading ? (
        <div className="mt-4 h-24 animate-pulse rounded-xl bg-muted/50" />
      ) : error ? (
        <p className="mt-4 text-sm text-muted-foreground">{t("cards.myFeedback.loadError")}</p>
      ) : feedback.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">{t("coacheeDashboard.feedbackDevelopment.empty")}</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {feedback.slice(0, 2).map((item) => (
            <li key={`${item.kind}-${item.id}`} className="border-b border-border/60 pb-3 last:border-0 last:pb-0">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[9px] font-bold uppercase tracking-widest text-primary">
                  {item.kind === "mentoring"
                    ? t("coacheeDashboard.feedbackDevelopment.fromMentor", { name: item.fromName ?? t("cards.myFeedback.someone") })
                    : t("coacheeDashboard.feedbackDevelopment.fromPeer", { name: item.fromName ?? t("cards.myFeedback.someone") })}
                </p>
                <span className="shrink-0 text-[10px] text-muted-foreground">{format(new Date(item.submittedAt), "MMM d")}</span>
              </div>
              {item.kind === "mentoring" && item.overallNotes && (
                <p className="font-display mt-1.5 line-clamp-2 text-[13px] text-foreground/80">“{item.overallNotes}”</p>
              )}
              {item.kind === "peer_competency" && item.note && (
                <p className="font-display mt-1.5 line-clamp-2 text-[13px] text-foreground/80">“{item.note}”</p>
              )}
            </li>
          ))}
        </ul>
      )}

      <Link to="/coachee/journey" className="mt-4 inline-block text-[11.5px] font-semibold text-primary hover:underline">
        {t("coacheeDashboard.feedbackDevelopment.viewAll")}
      </Link>
    </Card>
  );
}
