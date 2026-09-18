import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import { useAuth } from "@/context/AuthContext";
import { useEnrollmentContext } from "@/hooks/useEnrollmentContext";
import { useLearnerCanonicalProgress } from "@/hooks/useLearnerCanonicalProgress";
import { cn } from "@/lib/utils";

const STATUS_TONE: Record<string, string> = {
  active: "bg-white/15 text-white",
  completed: "bg-success/25 text-white",
  paused: "bg-white/10 text-white/80",
  at_risk: "bg-destructive/30 text-white",
};

/**
 * Programme Hero — approved prototype's navy banner, populated only from
 * learner_canonical_progress (the same enrollment-scoped engine every other
 * dashboard card reads). No sample programme/cohort/name is ever
 * substituted: with no active enrollment the hero renders the greeting
 * alone plus an explicit "no enrollment yet" notice.
 */
export function CoacheeProgrammeHero() {
  const { t } = useTranslation("dashboard");
  const { profile, user } = useAuth();
  const { selectedEnrollment, loading: enrollmentLoading } = useEnrollmentContext(user?.id);
  const enrollmentId = selectedEnrollment?.id;
  const { progress, journey, loading: progressLoading } = useLearnerCanonicalProgress(enrollmentId);

  const firstName = (profile?.full_name || "there").split(" ")[0];
  const initials = (profile?.full_name || "?")
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const now = new Date();
  const hour = now.getHours();
  const greetingKey = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";

  const loading = enrollmentLoading || progressLoading;
  const currentCheckpoint = journey.find((p) => p.state === "current")?.checkpoint_number ?? null;

  return (
    <div className="rounded-[18px] bg-secondary p-6 text-secondary-foreground shadow-[0_18px_55px_-30px_rgba(6,47,62,0.6)] sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-6">
        <div className="flex min-w-0 items-center gap-4">
          <div className="font-display grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white/15 text-lg">
            {initials}
          </div>
          <div className="min-w-0">
            <p className="text-[9.5px] font-bold uppercase tracking-[.24em] text-primary-glow">
              {t(`coachee.greeting.${greetingKey}`)}, {firstName}
            </p>
            {loading ? (
              <div className="mt-2 h-7 w-56 animate-pulse rounded bg-white/10" />
            ) : progress ? (
              <>
                <h1 className="font-display mt-1.5 text-[26px] leading-tight tracking-[-0.02em] sm:text-[30px]">
                  {progress.programme_label}
                </h1>
                <p className="mt-1 text-[12.5px] text-white/65">
                  {[
                    progress.cohort_label,
                    progress.programme_start_date && progress.programme_end_date
                      ? `${format(new Date(progress.programme_start_date), "d MMM yyyy")} – ${format(new Date(progress.programme_end_date), "d MMM yyyy")}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </>
            ) : (
              <p className="mt-1.5 max-w-sm text-[12.5px] text-white/65">{t("coacheeDashboard.hero.enrollmentRequired")}</p>
            )}
          </div>
        </div>

        {!loading && progress && (
          <div className="flex flex-wrap items-center gap-6">
            <div>
              <p className="text-[8.5px] font-bold uppercase tracking-[.16em] text-white/45">
                {t("coacheeDashboard.hero.enrollmentLabel")}
              </p>
              <span
                className={cn(
                  "mt-1 inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                  STATUS_TONE[progress.effective_enrollment_status] ?? "bg-white/10 text-white"
                )}
              >
                {t(`coacheeDashboard.hero.status.${progress.effective_enrollment_status}`, {
                  defaultValue: progress.effective_enrollment_status,
                })}
              </span>
            </div>
            {currentCheckpoint != null && journey.length > 0 && (
              <div>
                <p className="text-[8.5px] font-bold uppercase tracking-[.16em] text-white/45">
                  {t("coacheeDashboard.hero.positionLabel")}
                </p>
                <p className="mt-1 text-[12.5px] font-semibold">
                  {t("coacheeDashboard.hero.checkpointPosition", { current: currentCheckpoint, total: journey.length })}
                </p>
              </div>
            )}
            {progress.full_completion_pct != null && (
              <div className="text-right">
                <p className="font-display text-3xl leading-none">{Math.round(progress.full_completion_pct)}%</p>
                <p className="mt-1 text-[9.5px] font-semibold text-white/55">{t("coacheeDashboard.hero.programmeComplete")}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
