import { useTranslation } from "react-i18next";
import { useProgrammeModules } from "@/hooks/useProgrammeModules";
import { useMyCoachCardData } from "@/hooks/dashboard/useMyCoachCardData";
import { useModuleWorkspace } from "@/hooks/journey/useModuleWorkspace";
import { formatProfileDateTime } from "@/lib/programmeProfile";
import { nextOpenSession, orderSessionsForDisplay } from "@/lib/moduleSessions";
import {
  ModuleChip,
  ModulePersonCard,
  ModuleProgressCard,
  ModuleSessionList,
} from "@/components/programme/module/ModulePage";

/**
 * Coaching workspace (Coachee prototype → Coaching): My coach, Coaching
 * progress and Coaching sessions.
 *  - My coach: the learner's allowlisted coach (useMyCoachCardData).
 *  - Progress: canonical coaching_completed_units / coaching_required_units —
 *    NOT a count of completed session rows (that was a second calculation).
 *  - Sessions: canonical learner_session_history (coaching rows), real status.
 */
export function MyCoachSection() {
  const { t } = useTranslation("dashboard");
  const { hasDirection } = useProgrammeModules();
  const receiveEnabled = hasDirection("coaching", "receive");
  const ws = useModuleWorkspace("coaching");
  const { data: coach, loading: coachLoading } = useMyCoachCardData(ws.userId, receiveEnabled);
  const next = nextOpenSession(ws.sessions);

  // Coaching isn't a "receive" module for this enrollment: no workspace (the
  // nav hides the page too) — the coach directory below still renders.
  if (!receiveEnabled) return null;

  return (
    <div data-testid="coaching-workspace" className="flex flex-col gap-[18px]">
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(290px,1fr))]">
        <ModulePersonCard
          testId="my-coach"
          eyebrow={t("learnerModules.coaching.myCoach")}
          name={coachLoading ? null : coach?.full_name ?? null}
          subtitle={coach?.title}
          avatarUrl={coach?.avatar_url}
          empty={coachLoading ? "" : t("learnerModules.coaching.noCoach")}
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
        <ModuleProgressCard
          title={t("learnerModules.coaching.progressTitle")}
          completed={ws.completed}
          required={ws.required}
          label={t("learnerModules.sessionsCompleted")}
          note={t("learnerModules.coaching.privacy")}
          loading={ws.progressLoading}
        />
      </div>

      <ModuleSessionList
        testId="coaching-sessions"
        label={t("learnerModules.coaching.sessionsLabel")}
        sessions={orderSessionsForDisplay(ws.sessions)}
        loading={ws.sessionsLoading}
        error={ws.sessionsError}
        empty={t("learnerModules.coaching.noSessions")}
        errorText={t("learnerModules.sessionsError")}
      />
    </div>
  );
}
