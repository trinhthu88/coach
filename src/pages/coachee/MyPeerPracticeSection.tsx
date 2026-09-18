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
 * Peer coaching workspace — the learner's peer practice HISTORY (upcoming and
 * past sessions, received and given) from the canonical session history
 * (learner_session_history → coachee_peer_sessions), plus received
 * competency feedback. Always rendered, with its own empty state: partner
 * availability (the list below it on the page) is a different fact and must
 * never read as "you have no peer sessions".
 */
export function MyPeerPracticeSection() {
  const { t } = useTranslation("profile");
  const { user } = useAuth();
  const { selectedEnrollment, loading: enrollmentLoading } = useEnrollmentContext(user?.id);
  const enrollmentId = selectedEnrollment?.id;
  const { progress } = useLearnerCanonicalProgress(enrollmentId);
  const { sessions, loading: sessionsLoading, error: sessionsError } = useEnrollmentSessions(enrollmentId, user?.id);
  const { feedback, loading: feedbackLoading } = useLearnerFeedback(user?.id, enrollmentId);

  const peerSessions = useMemo(() => sessions.filter((s) => s.type === "peer_coaching"), [sessions]);
  const upcoming = useMemo(
    () =>
      peerSessions
        .filter((s) => s.status !== "completed" && s.status !== "cancelled")
        .sort((a, b) => new Date(a.startTime ?? 0).getTime() - new Date(b.startTime ?? 0).getTime()),
    [peerSessions]
  );
  const past = useMemo(() => peerSessions.filter((s) => s.status === "completed" || s.status === "cancelled"), [peerSessions]);
  const peerFeedback = useMemo(() => feedback.filter((f) => f.kind === "peer_competency"), [feedback]);

  const evidenceCount = peerSessions.filter((s) => s.isProgrammeEvidence).length;
  const loading = enrollmentLoading || sessionsLoading;
  if (!enrollmentId && !enrollmentLoading) return null;

  return (
    <section data-testid="peer-history" className="space-y-4">
      <div>
        <h2 className="font-display text-lg">{t("myPeerPractice.historyTitle")}</h2>
        {!loading && !sessionsError && (
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">
            {t("myPeerPractice.historySummary", {
              count: peerSessions.length,
              evidence: evidenceCount,
              completed: progress?.peer_completed_units ?? 0,
              required: progress?.peer_required_units ?? 0,
            })}
          </p>
        )}
      </div>
      {loading ? (
        <div className="h-16 animate-pulse rounded-lg bg-muted/50" />
      ) : sessionsError ? (
        <Card role="alert" className="border-destructive/30 bg-destructive/5 p-5 text-center text-sm text-destructive">
          {t("myPeerPractice.historyError")}
        </Card>
      ) : peerSessions.length === 0 ? (
        <Card className="p-5 text-center text-sm text-muted-foreground">{t("myPeerPractice.noHistory")}</Card>
      ) : (
        <>
      <div>
        <p className="mb-2 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{t("myPeerPractice.upcoming")}</p>
        {upcoming.length === 0 ? (
          <Card className="p-5 text-center text-sm text-muted-foreground">{t("myPeerPractice.noUpcoming")}</Card>
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
          <p className="mb-2 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{t("myPeerPractice.completed")}</p>
          <DevelopmentSessionsList
            sessions={past.slice(0, 5)}
            programmeName={progress?.programme_label ?? null}
            cohortName={progress?.cohort_label ?? null}
          />
        </div>
      )}

      <div>
        <p className="mb-2 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{t("myPeerPractice.feedback")}</p>
        {feedbackLoading ? (
          <div className="h-16 animate-pulse rounded-lg bg-muted/50" />
        ) : peerFeedback.length === 0 ? (
          <Card className="p-5 text-center text-sm text-muted-foreground">{t("myPeerPractice.noFeedback")}</Card>
        ) : (
          <div className="space-y-2">
            {peerFeedback.slice(0, 3).map((f) => (
              <Card key={f.id} className="p-4">
                <p className="text-[10px] text-muted-foreground">{format(new Date(f.submittedAt), "MMM d, yyyy")}</p>
                {f.note && <p className="mt-1.5 whitespace-pre-wrap text-sm">{f.note}</p>}
              </Card>
            ))}
          </div>
        )}
      </div>
        </>
      )}
    </section>
  );
}
