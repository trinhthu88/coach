import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useLearnerFeedback } from "@/hooks/dashboard/useLearnerFeedback";
import { useModuleWorkspace } from "@/hooks/journey/useModuleWorkspace";
import { feedbackText } from "@/lib/feedbackLabels";
import { formatProfileDate, formatProfileDateTime } from "@/lib/programmeProfile";
import { nextOpenSession, orderSessionsForDisplay } from "@/lib/moduleSessions";
import { sessionDetailPath } from "@/lib/sessionPaths";
import {
  ModuleCard,
  ModuleChip,
  ModuleEyebrow,
  ModuleFeedbackQuote,
  ModulePersonCard,
  ModuleSessionList,
} from "@/components/programme/module/ModulePage";

/**
 * Mentoring workspace (Coachee prototype → Mentoring): My mentor,
 * Preparation, Mentoring sessions, and the latest mentor feedback.
 *  - My mentor: counterpart of the next/latest canonical mentoring session,
 *    else the learner's allowlisted mentor (get_my_mentors, passed in).
 *  - Progress chip: canonical mentoring_completed_units / _required_units.
 *  - Preparation: the existing per-session preparation flow on the session
 *    detail (prep file + notes). No second write path is created here.
 *  - Sessions: canonical learner_session_history (mentoring rows).
 *  - Feedback: the learner feedback source (mentoring_feedback / mentor
 *    shared notes) — never mentor-private content.
 */
export function MyMentorSection({ fallbackMentorName = null }: { fallbackMentorName?: string | null }) {
  const { t } = useTranslation("dashboard");
  const ws = useModuleWorkspace("mentoring");
  const feedback = useLearnerFeedback(ws.userId, ws.enrollmentId);
  if (!ws.enrollmentId && !ws.enrollmentLoading) return null;

  const ordered = orderSessionsForDisplay(ws.sessions);
  const next = nextOpenSession(ws.sessions);
  const mentorName = (next ?? ordered[0])?.counterpartName ?? fallbackMentorName;
  const nextPath = next ? sessionDetailPath(next) : null;
  const latestFeedback = feedback.feedback.find((f) => f.kind === "mentoring" || (f.kind === "session_note" && f.source === "mentoring")) ?? null;

  return (
    <div data-testid="mentoring-workspace" className="flex flex-col gap-[18px]">
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(290px,1fr))]">
        <ModulePersonCard
          testId="my-mentor"
          eyebrow={t("learnerModules.mentoring.myMentor")}
          name={ws.sessionsLoading ? null : mentorName}
          empty={ws.sessionsLoading ? "" : t("learnerModules.mentoring.noMentor")}
          chips={
            <>
              <ModuleChip>
                <strong>{t("learnerModules.next")}</strong> · {next?.startTime ? formatProfileDateTime(next.startTime) : t("learnerModules.noneBooked")}
              </ModuleChip>
              {ws.required != null && (
                <ModuleChip>
                  <strong>
                    {ws.completed} / {ws.required}
                  </strong>{" "}
                  {t("learnerModules.sessionsComplete")}
                </ModuleChip>
              )}
            </>
          }
        />
        <ModuleCard testId="mentoring-preparation">
          <ModuleEyebrow>{t("learnerModules.mentoring.preparation")}</ModuleEyebrow>
          <h2 className="mt-[7px] font-serif text-[19px] font-normal tracking-[-.02em] text-[#062f3e]">{t("learnerModules.mentoring.prepTitle")}</h2>
          <p className="mt-2 text-[11.5px] leading-[1.6] text-[#7d7468]">{t("learnerModules.mentoring.prepBody")}</p>
          {nextPath ? (
            <Link to={nextPath} className="mt-3 inline-block rounded-full border border-[#d8d1c6] px-[13px] py-2 text-[10.5px] font-bold text-[#062f3e] hover:border-[#8bd3e3]">
              {t("learnerModules.mentoring.addPreparation")}
            </Link>
          ) : (
            <p className="mt-3 text-[11px] text-[#9a9287]">{t("learnerModules.mentoring.prepNoSession")}</p>
          )}
        </ModuleCard>
      </div>

      <ModuleFeedbackQuote
        eyebrow={t("learnerModules.mentoring.feedbackTitle")}
        quote={latestFeedback ? feedbackText(latestFeedback) : null}
        byline={latestFeedback ? [latestFeedback.fromName, formatProfileDate(latestFeedback.submittedAt)].filter(Boolean).join(" · ") : undefined}
        empty={feedback.error ? t("learnerProfile.errors.feedback") : t("learnerModules.mentoring.noFeedback")}
      />

      <ModuleSessionList
        testId="mentoring-sessions"
        label={t("learnerModules.mentoring.sessionsLabel")}
        sessions={ordered}
        loading={ws.sessionsLoading}
        error={ws.sessionsError}
        empty={t("learnerModules.mentoring.noSessions")}
        errorText={t("learnerModules.sessionsError")}
      />
    </div>
  );
}
