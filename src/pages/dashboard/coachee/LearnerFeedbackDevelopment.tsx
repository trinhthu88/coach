import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useLearnerFeedback, type LearnerFeedbackItem } from "@/hooks/dashboard/useLearnerFeedback";
import { feedbackAuthorLabel, feedbackModule, feedbackSourcePath, feedbackText, feedbackTypeLabel } from "@/lib/feedbackLabels";
import { useEnrollmentDevelopmentJourney } from "@/hooks/journey/useEnrollmentDevelopmentJourney";
import { useLearnerReflectionFeed, type LearnerReflection } from "@/hooks/journey/useLearnerReflectionFeed";
import { sessionDetailPathFor } from "@/lib/sessionPaths";
import { formatProfileDate } from "@/lib/programmeProfile";
import {
  ProfileLoadError,
  ProfileSection,
  ProfileSectionTitle,
  ProfileSkeleton,
  SmallMetric,
  UnavailableNote,
} from "@/components/programme/primitives";

const RECENT_LIMIT = 4;
const ACTIVITY_LIMIT = 3;

type RecentItem = {
  key: string;
  kind: "feedback" | "reflection";
  typeLabel: string;
  source: string;
  date: string;
  excerpt: string | null;
  module: string | null;
  path?: string | null;
};

/**
 * Learner Feedback & Development — learner-only (the sponsor surface has no
 * equivalent). Two existing, learner-visible sources:
 *  - useLearnerFeedback: mentoring_feedback (mentor → mentee),
 *    peer_session_competency_feedback about the learner, and the shared
 *    (non-private) session notes coaches, mentors and practice partners
 *    write for the learner — enrollment-scoped.
 *    coach_session_feedback is coach/admin-private and is never read.
 *  - useLearnerReflectionFeed: the canonical learner reflection feed
 *    (learner_reflection_feed) — the same feed My Journey → Reflections
 *    renders in full; the Dashboard shows the latest slice.
 *  - useEnrollmentDevelopmentJourney: recent development activity (goals,
 *    actions, sessions, training) — the same array My Journey's timeline uses.
 * A fetch failure renders an error, never an empty "No feedback yet".
 */
export function LearnerFeedbackDevelopment({ userId, enrollmentId }: { userId: string | undefined; enrollmentId: string | undefined }) {
  const { t } = useTranslation("dashboard");
  const { t: tSponsor } = useTranslation("sponsor");
  const feedback = useLearnerFeedback(userId, enrollmentId);
  const development = useEnrollmentDevelopmentJourney(enrollmentId, userId);
  // Same canonical reflection feed My Journey → Reflections renders in full.
  const reflectionFeed = useLearnerReflectionFeed(enrollmentId);

  const reflections = reflectionFeed.reflections;
  const activity = development.events.filter((e) => e.type !== "reflection" && e.type !== "feedback");
  const latest = development.events[0] ?? null;

  const moduleLabel = (module: string | null) => {
    if (!module) return null;
    const key = module === "peer_coaching" ? "peer" : module;
    return tSponsor(`cohortDetail.modules.${key}`, { defaultValue: module });
  };

  const recent: RecentItem[] = [
    ...feedback.feedback.map((item) => feedbackToRecent(item, t)),
    ...reflections.map((item) => reflectionToRecent(item, t)),
  ]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, RECENT_LIMIT);

  const loading = feedback.loading || development.loading || reflectionFeed.loading;

  return (
    <ProfileSection id="feedback-development" className="mt-4">
      <ProfileSectionTitle title={t("learnerProfile.feedback.title")} aside={t("learnerProfile.feedback.aside")} />
      {loading ? (
        <ProfileSkeleton className="h-32" />
      ) : (
        <>
          <div data-testid="feedback-summary" className="mt-5 flex flex-wrap gap-x-[34px] gap-y-5">
            <SmallMetric value={feedback.error ? "—" : String(feedback.feedback.length)} label={t("learnerProfile.feedback.feedbackCount")} />
            <SmallMetric value={reflectionFeed.error ? "—" : String(reflections.length)} label={t("learnerProfile.feedback.reflectionCount")} />
            <SmallMetric value={latest ? formatProfileDate(latest.occurredAt) : "—"} label={t("learnerProfile.feedback.latestActivity")} />
          </div>

          {feedback.error && <ProfileLoadError text={t("learnerProfile.errors.feedback")} />}
          {reflectionFeed.error && <ProfileLoadError text={t("learnerProfile.errors.reflections")} />}
          {development.error && <ProfileLoadError text={t("learnerProfile.errors.development")} />}
          {development.partialFailure && !development.error && <ProfileLoadError text={t("learnerProfile.errors.developmentPartial")} />}

          <div className="mt-5 grid gap-5 border-t border-[#eee8de] pt-4 lg:grid-cols-[1.4fr_1fr]">
            <div>
              <div className="text-[9.5px] font-bold uppercase tracking-[.14em] text-[#9a938a]">{t("learnerProfile.feedback.recentTitle")}</div>
              {recent.length === 0 ? (
                !feedback.error && !reflectionFeed.error && <UnavailableNote text={t("learnerProfile.feedback.empty")} locked={false} />
              ) : (
                <ul data-testid="feedback-recent" className="mt-3 flex flex-col gap-2.5">
                  {recent.map((item) => (
                    <li key={item.key} data-testid={`recent-${item.kind}`} className="rounded-xl border border-[#eee8de] bg-[#f6f3ee] p-3.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="rounded-full bg-[#e4f3f7] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[.12em] text-[#2c8fa8]">{item.typeLabel}</span>
                        <span className="text-[10px] text-[#9a938a]">{formatProfileDate(item.date)}</span>
                      </div>
                      {item.source && <p className="mt-1.5 text-[12px] font-semibold text-[#062f3e]">{item.source}</p>}
                      {item.excerpt && <p className="mt-1 line-clamp-2 font-serif text-[12.5px] leading-relaxed text-[#6a6560]">“{item.excerpt}”</p>}
                      <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-2 text-[9.5px] text-[#9a938a]">
                        {moduleLabel(item.module) && <span>{t("learnerProfile.feedback.module", { module: moduleLabel(item.module) })}</span>}
                        {item.path && (
                          <Link to={item.path} className="font-semibold text-[#2c8fa8] hover:underline">
                            {t("learnerProfile.feedback.openSource")}
                          </Link>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <div className="text-[9.5px] font-bold uppercase tracking-[.14em] text-[#9a938a]">{t("learnerProfile.feedback.activityTitle")}</div>
              {activity.length === 0 ? (
                !development.error && <p className="mt-3 text-[11px] text-[#9a938a]">{t("learnerProfile.feedback.noActivity")}</p>
              ) : (
                <ul data-testid="development-activity" className="mt-3 flex flex-col gap-2">
                  {activity.slice(0, ACTIVITY_LIMIT).map((event) => (
                    <li key={event.id} className="border-b border-[#eee8de] pb-2 last:border-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-[11px] font-semibold text-[#062f3e]">{event.title}</span>
                        <span className="shrink-0 text-[9.5px] text-[#9a938a]">{formatProfileDate(event.occurredAt)}</span>
                      </div>
                      {event.summary && <p className="mt-0.5 truncate text-[10.5px] text-[#6a6560]">{event.summary}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <p className="mt-4 text-[10.5px] leading-relaxed text-[#9a938a]">{t("learnerProfile.feedback.privacy")}</p>
        </>
      )}
      <Link to="/coachee/journey#feedback" className="mt-3 inline-block text-[11.5px] font-semibold text-[#2c8fa8] hover:underline">
        {t("learnerProfile.feedback.viewAll")}
      </Link>
    </ProfileSection>
  );
}

function feedbackToRecent(item: LearnerFeedbackItem, t: (key: string, options?: Record<string, unknown>) => string): RecentItem {
  return {
    key: `${item.kind}-${item.id}`,
    kind: "feedback",
    typeLabel: feedbackTypeLabel(item, t),
    source: feedbackAuthorLabel(item, t),
    date: item.submittedAt,
    excerpt: feedbackText(item),
    module: feedbackModule(item),
    path: feedbackSourcePath(item),
  };
}

function reflectionToRecent(item: LearnerReflection, t: (key: string, options?: Record<string, unknown>) => string): RecentItem {
  return {
    key: item.key,
    kind: "reflection",
    typeLabel: t(`learnerProfile.reflections.sources.${item.sourceType}`),
    source: item.title ?? "",
    date: item.occurredAt,
    excerpt: item.body,
    module: item.module,
    path: item.linkedSessionTable && item.linkedSessionId ? sessionDetailPathFor(item.linkedSessionTable, item.linkedSessionId) : "/coachee/journey#reflections",
  };
}
