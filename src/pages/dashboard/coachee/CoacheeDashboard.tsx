import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ShieldCheck } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useEnrollmentContext } from "@/hooks/useEnrollmentContext";
import { useLearnerCanonicalEngagement, useLearnerCanonicalProgress } from "@/hooks/useLearnerCanonicalProgress";
import { useEnrollmentActionsSummary } from "@/hooks/dashboard/useEnrollmentActionsSummary";
import { formatProfileDate, journeyFocusIndex, type ProgrammeModuleKey } from "@/lib/programmeProfile";
import { STATUS_LABEL_KEY, STATUS_TONE, effectiveSponsorStatus } from "@/pages/sponsor/sponsorUtils";
import { ProfileLoadError, ProfileSection, ProfileSkeleton } from "@/components/programme/primitives";
import { PROFILE_COLORS } from "@/components/programme/profileTheme";
import { ProgrammeProfileHeader } from "@/components/programme/ProgrammeProfileHeader";
import { ProgrammeMetricCards } from "@/components/programme/ProgrammeMetricCards";
import { ProgrammeProgressParticipation } from "@/components/programme/ProgrammeProgressParticipation";
import { ProgrammeModuleProgress } from "@/components/programme/ProgrammeModuleProgress";
import { ProgrammeExperienceRating } from "@/components/programme/ProgrammeEngagementCards";
import { LearnerProgrammeJourney } from "@/components/programme/LearnerProgrammeJourney";
import { LearnerGoalsActions } from "./LearnerGoalsActions";
import { LearnerFeedbackDevelopment } from "./LearnerFeedbackDevelopment";
import { LearnerAttention } from "./LearnerAttention";
import { LearnerSessionActions } from "./LearnerSessionActions";

const MODULE_PATH: Record<ProgrammeModuleKey, string> = {
  coaching: "/coaches",
  training: "/training",
  peer: "/coachee/peer-practice",
  mentoring: "/mentoring",
  triads: "/triads",
};

/**
 * Learner (coachee) Dashboard — the learner-facing version of Sponsor →
 * Leader Detail, built from the same shared programme-profile components
 * (src/components/programme) in the same order: header → KPI cards →
 * Programme Journey → Progress & participation + Module progress → Goals &
 * actions + Programme experience → attention → (learner-only) Feedback &
 * development. Every shared fact comes from learner_canonical_* /
 * learner_canonical_engagement, which run the exact calculations Sponsor's
 * sponsor_canonical_* functions run, so both surfaces show the same values
 * for the same enrollment. Only Goals & actions and Feedback & development
 * carry extra, learner-private detail.
 */
export function CoacheeDashboard() {
  const { t } = useTranslation("dashboard");
  const { t: tSponsor } = useTranslation("sponsor");
  const { user, profile } = useAuth();
  const { selectedEnrollment, loading: enrollmentLoading } = useEnrollmentContext(user?.id);
  const enrollmentId = selectedEnrollment?.id;
  const canonical = useLearnerCanonicalProgress(enrollmentId);
  const engagement = useLearnerCanonicalEngagement(enrollmentId);
  const actions = useEnrollmentActionsSummary(enrollmentId);
  const { progress, journey, experience } = canonical;

  const displayName = progress?.learner_display_name || profile?.full_name || "";
  const loading = enrollmentLoading || canonical.loading;

  if (loading) {
    return (
      <div className="animate-rise" data-testid="learner-dashboard-loading">
        <ProfileSkeleton className="h-[120px] rounded-[16px]" />
        <ProfileSkeleton className="h-[96px]" />
        <ProfileSkeleton className="h-[320px]" />
      </div>
    );
  }

  if (canonical.error) {
    return (
      <div className="animate-rise">
        <ProgrammeProfileHeader name={displayName} eyebrow={t("learnerProfile.header.eyebrow")} subtitle="" metas={[]} />
        <ProfileSection className="mt-4">
          <ProfileLoadError text={t("learnerProfile.errors.progress")} onRetry={canonical.retry} retryLabel={t("learnerProfile.errors.retry")} />
        </ProfileSection>
      </div>
    );
  }

  if (!progress) {
    return (
      <div className="animate-rise">
        <ProgrammeProfileHeader name={displayName} eyebrow={t("learnerProfile.header.eyebrow")} subtitle={t("coacheeDashboard.hero.enrollmentRequired")} metas={[]} />
      </div>
    );
  }

  const status = effectiveSponsorStatus(progress);
  const statusLabel = tSponsor(`status.${STATUS_LABEL_KEY[status]}`);
  const focus = journeyFocusIndex(journey);

  return (
    <div className="animate-rise pb-4" style={{ color: PROFILE_COLORS.NAVY }} data-testid="learner-dashboard">
      <ProgrammeProfileHeader
        name={displayName}
        eyebrow={t("learnerProfile.header.eyebrow")}
        subtitle={`${progress.programme_label} · ${progress.cohort_label || "—"}`}
        metas={[
          { label: t("learnerProfile.header.programmeStatus"), value: statusLabel },
          {
            label: t("learnerProfile.header.coaching"),
            value: t("learnerProfile.header.coachingValue", {
              completed: progress.coaching_completed_units,
              allocated: progress.coaching_required_units,
            }),
          },
          ...(focus >= 0
            ? [{ label: t("learnerProfile.header.position"), value: t("coacheeDashboard.hero.checkpointPosition", { current: journey[focus].checkpoint_number, total: journey.length }) }]
            : []),
          { label: tSponsor("leaderDrawer.reference.dates"), value: `${formatProfileDate(progress.enrollment_start_date)} – ${formatProfileDate(progress.enrollment_end_date)}` },
        ]}
        status={{ tone: STATUS_TONE[status], label: statusLabel }}
      />

      <h2 className="sr-only">{tSponsor("leaderDrawer.overview")}</h2>
      <ProgrammeMetricCards facts={progress} engagement={engagement.engagement} viewer="learner" />

      <LearnerProgrammeJourney
        id="programme-journey"
        enrollmentId={enrollmentId}
        variant="summary"
        action={
          <Link to="/coachee/journey#programme-journey" className="text-[11.5px] font-semibold text-[#2c8fa8] hover:underline">
            {t("coacheeDashboard.journeyPreview.viewFull")}
          </Link>
        }
      />

      <div className="mt-4 grid items-start gap-4 [grid-template-columns:repeat(auto-fit,minmax(340px,1fr))]">
        <ProgrammeProgressParticipation facts={progress} journey={journey} coachingUtilisation={experience.coachingUtilisation} viewer="learner">
          <LearnerSessionActions userId={user?.id} enrollmentId={enrollmentId} />
        </ProgrammeProgressParticipation>
        <ProgrammeModuleProgress
          facts={progress}
          learningBreakdown={experience.learningBreakdown}
          viewer="learner"
          moduleAction={(key) => (
            <Link to={MODULE_PATH[key]} className="font-semibold text-[#2c8fa8] hover:underline">
              {t("learnerProfile.modules.open")}
            </Link>
          )}
          learningAction={
            <Link to="/training" className="mt-3 inline-block text-[11px] font-semibold text-[#2c8fa8] hover:underline">
              {t("learnerProfile.modules.openTraining")}
            </Link>
          }
        />
      </div>

      <div className="mt-4 grid items-start gap-4 [grid-template-columns:repeat(auto-fit,minmax(340px,1fr))]">
        <LearnerGoalsActions userId={user?.id} enrollmentId={enrollmentId} engagement={engagement.engagement} engagementError={engagement.error} />
        <ProgrammeExperienceRating engagement={engagement.engagement} viewer="learner" />
      </div>

      <LearnerAttention
        journey={journey}
        learningBreakdown={experience.learningBreakdown}
        overdueActions={actions.overdue}
        nextSessionAt={experience.coachingUtilisation?.next_session_at ?? null}
        loading={actions.loading}
        error={actions.error}
      />

      <LearnerFeedbackDevelopment userId={user?.id} enrollmentId={enrollmentId} />

      <section className="mt-4 rounded-[14px] border border-[#3db4d0]/25 bg-[#e4f5fa]/55 p-[22px]">
        <div className="mb-2 flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-[#2c8fa8]" />
          <p className="text-[11px] font-bold uppercase tracking-[.16em]">{t("learnerProfile.privacy.title")}</p>
        </div>
        <p className="max-w-[84ch] text-[11.5px] leading-[1.6] text-[#6a6560]">{t("learnerProfile.privacy.body")}</p>
      </section>
    </div>
  );
}
