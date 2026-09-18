import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { useEnrollmentContext } from "@/hooks/useEnrollmentContext";
import { useLearnerCanonicalProgress } from "@/hooks/useLearnerCanonicalProgress";
import { useEnrollmentSessions } from "@/hooks/journey/useEnrollmentSessions";
import { DevelopmentSessionsList } from "@/pages/journey/DevelopmentSessionsList";
import { Card } from "@/components/ui/card";

const OPEN_STATUSES = new Set(["pending_coach_approval", "confirmed", "proposed"]);

/**
 * Upcoming sessions — a preview slice of the exact same unified session
 * projection (useEnrollmentSessions) and row component
 * (DevelopmentSessionsList) the full Sessions page and My Journey Sessions
 * tab use; no separate session query or card layout for this preview.
 */
export function CoacheeUpcomingSessionsCard({ limit = 2 }: { limit?: number }) {
  const { t } = useTranslation("dashboard");
  const { user } = useAuth();
  const { selectedEnrollment, loading: enrollmentLoading } = useEnrollmentContext(user?.id);
  const enrollmentId = selectedEnrollment?.id;
  const { progress } = useLearnerCanonicalProgress(enrollmentId);
  const { sessions, loading: sessionsLoading } = useEnrollmentSessions(enrollmentId, user?.id);

  const upcoming = useMemo(() => {
    const now = Date.now();
    return sessions
      .filter((s) => OPEN_STATUSES.has(s.status) && s.startTime && new Date(s.startTime).getTime() >= now)
      .sort((a, b) => new Date(a.startTime as string).getTime() - new Date(b.startTime as string).getTime())
      .slice(0, limit);
  }, [sessions, limit]);

  const loading = enrollmentLoading || sessionsLoading;

  return (
    <Card className="p-5">
      <p className="font-display text-lg">{t("coacheeDashboard.upcomingSessions.title")}</p>
      <p className="mt-0.5 text-[11.5px] text-muted-foreground">{t("coacheeDashboard.upcomingSessions.subtitle")}</p>

      <div className="mt-4">
        {loading ? (
          <div className="h-24 animate-pulse rounded-xl bg-muted/50" />
        ) : upcoming.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
            {t("coacheeDashboard.upcomingSessions.empty")}
          </p>
        ) : (
          <DevelopmentSessionsList
            sessions={upcoming}
            programmeName={progress?.programme_label ?? null}
            cohortName={progress?.cohort_label ?? null}
          />
        )}
      </div>

      <Link to="/sessions" className="mt-4 inline-block text-[11.5px] font-semibold text-primary hover:underline">
        {t("coacheeDashboard.upcomingSessions.viewAll")}
      </Link>
    </Card>
  );
}
