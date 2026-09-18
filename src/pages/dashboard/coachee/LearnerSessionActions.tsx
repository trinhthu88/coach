import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useEnrollmentSessions } from "@/hooks/journey/useEnrollmentSessions";
import { sessionDetailPath } from "@/lib/sessionPaths";
import { formatProfileDateTime } from "@/lib/programmeProfile";
import { ProfileLoadError } from "@/components/programme/primitives";

const OPEN_STATUSES = new Set(["pending_coach_approval", "confirmed", "proposed"]);
const UPCOMING_LIMIT = 2;

/**
 * Learner-only scheduling detail inside Progress & participation: the next
 * booked sessions across modules (the same useEnrollmentSessions projection
 * the Sessions page reads) plus booking/viewing links. The sponsor card
 * stops at the canonical "Next session" line; this is the learner's own
 * calendar, so they get the actionable version.
 */
export function LearnerSessionActions({ userId, enrollmentId }: { userId: string | undefined; enrollmentId: string | undefined }) {
  const { t } = useTranslation("dashboard");
  const { t: tJourney } = useTranslation("journey");
  const { sessions, loading, error } = useEnrollmentSessions(enrollmentId, userId);

  const upcoming = useMemo(() => {
    const now = Date.now();
    return sessions
      .filter((s) => OPEN_STATUSES.has(s.status) && s.startTime && new Date(s.startTime).getTime() >= now)
      .sort((a, b) => new Date(a.startTime as string).getTime() - new Date(b.startTime as string).getTime())
      .slice(0, UPCOMING_LIMIT);
  }, [sessions]);

  return (
    <div className="mt-3">
      {loading ? null : error ? (
        <ProfileLoadError text={t("learnerProfile.errors.sessions")} />
      ) : upcoming.length === 0 ? (
        <p className="text-[10.5px] text-[#9a938a]">{t("coacheeDashboard.upcomingSessions.empty")}</p>
      ) : (
        <ul data-testid="learner-upcoming-sessions" className="flex flex-col gap-1.5">
          {upcoming.map((session) => {
            const path = sessionDetailPath(session);
            const content = (
              <>
                <span className="text-[9px] font-bold uppercase tracking-[.12em] text-[#2c8fa8]">
                  {tJourney(`developmentSessions.types.${session.type}`, { defaultValue: session.type })}
                </span>
                <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-[#062f3e]">{session.title}</span>
                <span className="shrink-0 text-[10px] text-[#6a6560]">{formatProfileDateTime(session.startTime as string)}</span>
              </>
            );
            return (
              <li key={session.id}>
                {path ? (
                  <Link to={path} className="flex items-center gap-2 rounded-lg border border-[#eee8de] px-3 py-2 hover:border-[#8bd3e3]">
                    {content}
                  </Link>
                ) : (
                  <div className="flex items-center gap-2 rounded-lg border border-[#eee8de] px-3 py-2">{content}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Link to="/coaches" className="rounded-full bg-[#062f3e] px-3.5 py-1.5 text-[11px] font-semibold text-white hover:bg-[#0a3f53]">
          {t("learnerProfile.sessions.book")}
        </Link>
        <Link to="/sessions" className="rounded-full border border-[#cfc7bb] px-3.5 py-1.5 text-[11px] font-semibold text-[#062f3e] hover:border-[#8bd3e3]">
          {t("coacheeDashboard.upcomingSessions.viewAll")}
        </Link>
      </div>
    </div>
  );
}
