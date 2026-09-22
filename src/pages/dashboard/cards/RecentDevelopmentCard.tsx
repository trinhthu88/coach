import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import {
  History,
  Target,
  ListChecks,
  Users,
  MessagesSquare,
  UserCog,
  Users2,
  BookOpen,
  MessageSquareText,
  Star,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useActiveEnrollment } from "@/hooks/useActiveEnrollment";
import { useEnrollmentDevelopmentJourney } from "@/hooks/journey/useEnrollmentDevelopmentJourney";
import type { DevelopmentJourneyEventType } from "@/hooks/journey/developmentJourneyTypes";
import { DashboardCardShell, CardFooterLink, CardEmptyHint } from "./shared";

const ICON_BY_TYPE: Record<DevelopmentJourneyEventType, LucideIcon> = {
  goal: Target,
  action: ListChecks,
  coaching: Users,
  peer_coaching: MessagesSquare,
  mentoring: UserCog,
  triad: Users2,
  training: BookOpen,
  reflection: MessageSquareText,
  feedback: Star,
};

/**
 * "Recent Development" is the first N items of the exact same
 * useEnrollmentDevelopmentJourney projection the Development Journey page
 * renders in full — never a second calculation of the learner's history.
 */
export function RecentDevelopmentCard({ limit = 5 }: { limit?: number }) {
  const { t } = useTranslation("dashboard");
  const { user, role } = useAuth();
  const { enrollmentId: activeEnrollmentId, loading: enrollmentLoading } = useActiveEnrollment();
  const { events, loading } = useEnrollmentDevelopmentJourney(activeEnrollmentId ?? undefined, user?.id);
  const journeyPath = role === "coach" ? "/coach/my-journey" : "/coachee/journey";

  return (
    <DashboardCardShell icon={History} title={t("cards.recentDevelopment.title")} loading={enrollmentLoading || loading}>
      {events.length === 0 ? (
        <CardEmptyHint text={t("cards.recentDevelopment.empty")} />
      ) : (
        <ul className="space-y-2.5">
          {events.slice(0, limit).map((event) => {
            const Icon = ICON_BY_TYPE[event.type];
            return (
              <li key={event.id} className="flex items-start gap-2.5">
                <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary-soft text-primary">
                  <Icon className="h-3 w-3" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11.5px] font-semibold">{event.title}</p>
                  {event.summary && <p className="truncate text-[11px] text-muted-foreground">{event.summary}</p>}
                </div>
                <span className="shrink-0 text-[10px] text-muted-foreground">{format(new Date(event.occurredAt), "MMM d")}</span>
              </li>
            );
          })}
        </ul>
      )}
      <CardFooterLink to={journeyPath}>{t("cards.recentDevelopment.openJourney")}</CardFooterLink>
    </DashboardCardShell>
  );
}
