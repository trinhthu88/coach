import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { useEnrollmentContext } from "@/hooks/useEnrollmentContext";
import { Card } from "@/components/ui/card";
import { ProgrammeJourneyTimeline } from "@/components/journey/ProgrammeJourneyTimeline";
import { RecentDevelopmentCard } from "../cards/RecentDevelopmentCard";
import { CoacheeProgrammeHero } from "./CoacheeProgrammeHero";
import { CoacheeNextUpCard } from "./CoacheeNextUpCard";
import { CoacheeProgrammeProgressCard } from "./CoacheeProgrammeProgressCard";
import { CoacheeModuleProgressCard } from "./CoacheeModuleProgressCard";
import { CoacheeGoalsActionsCard } from "./CoacheeGoalsActionsCard";
import { CoacheeFeedbackDevelopmentCard } from "./CoacheeFeedbackDevelopmentCard";
import { CoacheeUpcomingSessionsCard } from "./CoacheeUpcomingSessionsCard";

/**
 * The approved Coachee Dashboard, section order per the prototype:
 * Programme Hero → Next up + Programme progress → Programme Journey preview
 * → Module progress + Goals & actions → Feedback & development + Upcoming
 * sessions → Recent development. Every section reads real canonical data
 * through the same hooks the rest of the app already uses (see each card's
 * own doc comment) — nothing here recomputes a fact a second way, and every
 * section renders its own honest empty state rather than sample content.
 */
export function CoacheeDashboard() {
  const { t } = useTranslation("dashboard");
  const { user } = useAuth();
  const { selectedEnrollment } = useEnrollmentContext(user?.id);
  const enrollmentId = selectedEnrollment?.id;

  return (
    <div className="animate-rise space-y-5">
      <CoacheeProgrammeHero />

      <div className="grid gap-4 lg:grid-cols-[1.5fr_0.7fr]">
        <CoacheeNextUpCard />
        <CoacheeProgrammeProgressCard />
      </div>

      <Card className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-display text-lg">{t("coacheeDashboard.journeyPreview.title")}</p>
            <p className="mt-0.5 text-[11.5px] text-muted-foreground">{t("coacheeDashboard.journeyPreview.subtitle")}</p>
          </div>
          <Link to="/coachee/journey" className="shrink-0 text-[11.5px] font-semibold text-primary hover:underline">
            {t("coacheeDashboard.journeyPreview.viewFull")}
          </Link>
        </div>
        <div className="mt-4">
          <ProgrammeJourneyTimeline enrollmentId={enrollmentId} variant="preview" />
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <CoacheeModuleProgressCard />
        <CoacheeGoalsActionsCard />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <CoacheeFeedbackDevelopmentCard />
        <CoacheeUpcomingSessionsCard />
      </div>

      <RecentDevelopmentCard />
    </div>
  );
}
