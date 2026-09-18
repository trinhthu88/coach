import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import { useAuth } from "@/context/AuthContext";
import { useEnrollmentContext } from "@/hooks/useEnrollmentContext";
import { useEnrollmentSessions } from "@/hooks/journey/useEnrollmentSessions";
import { useLearnerFeedback } from "@/hooks/dashboard/useLearnerFeedback";
import { useLearnerCanonicalProgress } from "@/hooks/useLearnerCanonicalProgress";
import { DevelopmentSessionsList } from "@/pages/journey/DevelopmentSessionsList";
import { Card } from "@/components/ui/card";

/**
 * "My Mentor" workspace — approved prototype's Page 7 (Mentoring): current
 * mentor (derived from actual booked mentoring_sessions — mentoring has no
 * fixed 1:1 assignment like coaching's allowlist, only a bookable pool), next
 * session, past sessions, and learner-visible mentoring feedback. Renders
 * nothing when there is no mentoring session yet, so the existing "Find a
 * Mentor" list below remains the empty-state experience per the brief.
 */
export function MyMentorSection() {
  const { t } = useTranslation("mentoring");
  const { user } = useAuth();
  const { selectedEnrollment, loading: enrollmentLoading } = useEnrollmentContext(user?.id);
  const enrollmentId = selectedEnrollment?.id;
  const { progress } = useLearnerCanonicalProgress(enrollmentId);
  const { sessions, loading: sessionsLoading } = useEnrollmentSessions(enrollmentId, user?.id);
  const { feedback, loading: feedbackLoading } = useLearnerFeedback(user?.id, enrollmentId);

  const mentoringSessions = useMemo(() => sessions.filter((s) => s.type === "mentoring"), [sessions]);
  const upcoming = useMemo(
    () =>
      mentoringSessions
        .filter((s) => s.status !== "completed" && s.status !== "cancelled")
        .sort((a, b) => new Date(a.startTime ?? 0).getTime() - new Date(b.startTime ?? 0).getTime()),
    [mentoringSessions]
  );
  const past = useMemo(
    () => mentoringSessions.filter((s) => s.status === "completed" || s.status === "cancelled"),
    [mentoringSessions]
  );
  const mentorFeedback = useMemo(() => feedback.filter((f) => f.kind === "mentoring"), [feedback]);

  const loading = enrollmentLoading || sessionsLoading;
  const currentMentorName = (upcoming[0] ?? mentoringSessions[0])?.counterpartName ?? null;

  if (loading || mentoringSessions.length === 0) return null;

  return (
    <div className="space-y-4">
      {currentMentorName && (
        <Card className="p-5">
          <p className="text-[9px] font-bold uppercase tracking-widest text-primary">{t("myMentor.eyebrow")}</p>
          <h2 className="font-display mt-1 text-lg">{currentMentorName}</h2>
          {upcoming[0]?.startTime && (
            <p className="mt-1 text-[12px] text-muted-foreground">
              {t("myMentor.next")} · {format(new Date(upcoming[0].startTime), "MMM d, p")}
            </p>
          )}
        </Card>
      )}

      <div>
        <p className="mb-2 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{t("myMentor.upcoming")}</p>
        {upcoming.length === 0 ? (
          <Card className="p-5 text-center text-sm text-muted-foreground">{t("myMentor.noUpcoming")}</Card>
        ) : (
          <DevelopmentSessionsList
            sessions={upcoming}
            programmeName={progress?.programme_label ?? null}
            cohortName={progress?.cohort_label ?? null}
          />
        )}
      </div>

      {past.length > 0 && (
        <div>
          <p className="mb-2 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{t("myMentor.past")}</p>
          <DevelopmentSessionsList
            sessions={past.slice(0, 5)}
            programmeName={progress?.programme_label ?? null}
            cohortName={progress?.cohort_label ?? null}
          />
        </div>
      )}

      <div>
        <p className="mb-2 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{t("myMentor.feedback")}</p>
        {feedbackLoading ? (
          <div className="h-16 animate-pulse rounded-lg bg-muted/50" />
        ) : mentorFeedback.length === 0 ? (
          <Card className="p-5 text-center text-sm text-muted-foreground">{t("myMentor.noFeedback")}</Card>
        ) : (
          <div className="space-y-2">
            {mentorFeedback.slice(0, 3).map((f) => (
              <Card key={f.id} className="p-4">
                <p className="text-[10px] text-muted-foreground">{format(new Date(f.submittedAt), "MMM d, yyyy")}</p>
                {f.overallNotes && <p className="mt-1.5 whitespace-pre-wrap text-sm">{f.overallNotes}</p>}
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
