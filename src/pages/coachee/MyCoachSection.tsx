import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { UserCircle2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useEnrollmentContext } from "@/hooks/useEnrollmentContext";
import { useProgrammeModules } from "@/hooks/useProgrammeModules";
import { useMyCoachCardData } from "@/hooks/dashboard/useMyCoachCardData";
import { useEnrollmentSessions } from "@/hooks/journey/useEnrollmentSessions";
import { useLearnerCanonicalProgress } from "@/hooks/useLearnerCanonicalProgress";
import { DevelopmentSessionsList } from "@/pages/journey/DevelopmentSessionsList";
import { Card } from "@/components/ui/card";

/**
 * "My Coach" workspace — approved prototype's Page 5 (Coaching): assigned
 * coach, next session, upcoming/past sessions. Renders nothing when the
 * Coaching module isn't configured for receiving, or when no coach is
 * allowlisted yet — the existing Coaches directory below still serves as
 * the "Find a Coach" experience either way, so nothing is lost.
 */
export function MyCoachSection() {
  const { t } = useTranslation("coaches");
  const { user } = useAuth();
  const { hasDirection, loading: modulesLoading } = useProgrammeModules();
  const receiveEnabled = hasDirection("coaching", "receive");
  const { data: coach, loading: coachLoading } = useMyCoachCardData(user?.id, receiveEnabled);
  const { selectedEnrollment, loading: enrollmentLoading } = useEnrollmentContext(user?.id);
  const enrollmentId = selectedEnrollment?.id;
  const { progress } = useLearnerCanonicalProgress(enrollmentId);
  const { sessions, loading: sessionsLoading } = useEnrollmentSessions(enrollmentId, user?.id);

  const coachingSessions = useMemo(() => sessions.filter((s) => s.type === "coaching"), [sessions]);
  const upcoming = useMemo(
    () =>
      coachingSessions
        .filter((s) => s.status !== "completed" && s.status !== "cancelled")
        .sort((a, b) => new Date(a.startTime ?? 0).getTime() - new Date(b.startTime ?? 0).getTime()),
    [coachingSessions]
  );
  const past = useMemo(
    () => coachingSessions.filter((s) => s.status === "completed" || s.status === "cancelled"),
    [coachingSessions]
  );

  const loading = modulesLoading || coachLoading || enrollmentLoading;
  if (loading || !receiveEnabled || !coach) return null;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card className="p-5">
          <div className="flex items-center gap-4">
            <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-2xl bg-primary-soft text-primary">
              {coach.avatar_url ? (
                <img src={coach.avatar_url} alt={coach.full_name} className="h-full w-full object-cover" />
              ) : (
                <UserCircle2 className="h-7 w-7" />
              )}
            </div>
            <div className="min-w-0">
              <p className="text-[9px] font-bold uppercase tracking-widest text-primary">{t("myCoach.eyebrow")}</p>
              <h2 className="font-display mt-0.5 text-lg">{coach.full_name}</h2>
              {coach.title && <p className="truncate text-[12px] text-muted-foreground">{coach.title}</p>}
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <Link
              to={`/coaches/${coach.id}`}
              className="rounded-lg border border-border bg-card px-3 py-1.5 text-[11px] font-semibold transition-colors hover:border-primary/40"
            >
              {t("myCoach.viewProfile")}
            </Link>
            {upcoming[0] && (
              <Link
                to={`/sessions/${upcoming[0].sourceId}`}
                className="rounded-lg bg-primary px-3 py-1.5 text-[11px] font-semibold text-primary-foreground"
              >
                {t("myCoach.viewNextSession")}
              </Link>
            )}
          </div>
        </Card>

        <Card className="p-5">
          <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{t("myCoach.progressLabel")}</p>
          <p className="font-display mt-1 text-2xl">
            {past.filter((s) => s.status === "completed").length}
            {progress?.coaching_required_units ? ` / ${progress.coaching_required_units}` : ""}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">{t("myCoach.sessionsCompleted")}</p>
        </Card>
      </div>

      <div>
        <p className="mb-2 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{t("myCoach.upcoming")}</p>
        {upcoming.length === 0 ? (
          <Card className="p-5 text-center text-sm text-muted-foreground">{t("myCoach.noUpcoming")}</Card>
        ) : (
          <DevelopmentSessionsList
            sessions={upcoming}
            loading={sessionsLoading}
            programmeName={progress?.programme_label ?? null}
            cohortName={progress?.cohort_label ?? null}
          />
        )}
      </div>

      {past.length > 0 && (
        <div>
          <p className="mb-2 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{t("myCoach.past")}</p>
          <DevelopmentSessionsList
            sessions={past.slice(0, 5)}
            loading={sessionsLoading}
            programmeName={progress?.programme_label ?? null}
            cohortName={progress?.cohort_label ?? null}
          />
        </div>
      )}
    </div>
  );
}
