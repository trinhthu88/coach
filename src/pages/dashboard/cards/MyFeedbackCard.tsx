import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import { MessageSquareHeart } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useEnrollmentContext } from "@/hooks/useEnrollmentContext";
import { useLearnerFeedback } from "@/hooks/dashboard/useLearnerFeedback";
import { feedbackAuthorLabel, feedbackText } from "@/lib/feedbackLabels";
import { DashboardCardShell, CardEmptyHint } from "./shared";

/**
 * Learner-visible feedback only — mentoring_feedback (RLS: mentee can read)
 * and peer_session_competency_feedback where this learner was rated as the
 * peer coach (RLS: both participants can read). coach_session_feedback is
 * never queried here: its RLS grants only the authoring coach and admins,
 * so there is no learner-safe way to surface it. Scoped to the selected
 * enrollment so feedback from a different enrollment never mixes in.
 */
export function MyFeedbackCard() {
  const { t } = useTranslation("dashboard");
  const { user } = useAuth();
  const { selectedEnrollment, loading: enrollmentLoading } = useEnrollmentContext(user?.id);
  const { feedback, loading, error } = useLearnerFeedback(user?.id, selectedEnrollment?.id);

  return (
    <DashboardCardShell icon={MessageSquareHeart} title={t("cards.myFeedback.title")} loading={loading || enrollmentLoading}>
      {error ? (
        <CardEmptyHint text={t("cards.myFeedback.loadError")} />
      ) : feedback.length === 0 ? (
        <CardEmptyHint text={t("cards.myFeedback.empty")} />
      ) : (
        <ul className="space-y-2.5">
          {feedback.slice(0, 3).map((item) => (
            <li key={`${item.kind}-${item.id}`} className="rounded-lg border border-border bg-muted/30 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-semibold">
                  {feedbackAuthorLabel(item, t)}
                </p>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {format(new Date(item.submittedAt), "MMM d")}
                </span>
              </div>
              {feedbackText(item) && <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{feedbackText(item)}</p>}
            </li>
          ))}
        </ul>
      )}
    </DashboardCardShell>
  );
}
