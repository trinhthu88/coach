import { useTranslation } from "react-i18next";
import { Users, ArrowUpRight } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useProgrammeModules } from "@/hooks/useProgrammeModules";
import { useEnrollmentContext } from "@/hooks/useEnrollmentContext";
import { useMyCoachCardData } from "@/hooks/dashboard/useMyCoachCardData";
import { DashboardCardShell, CardFooterLink, CardEmptyHint } from "./shared";

/**
 * "Your Coaching team" -- every Coach assigned to the learner's cohort.
 *
 * A cohort has a Coach pool and the learner may book a different Coach for
 * each Coaching requirement, so presenting one permanent "my coach" would
 * assert a relationship the model does not contain.
 */
export function MyCoachCard() {
  const { t } = useTranslation("dashboard");
  const { user } = useAuth();
  const { selectedEnrollment } = useEnrollmentContext(user?.id);
  const { hasDirection, loading: modulesLoading } = useProgrammeModules();
  const enabled = hasDirection("coaching", "receive");
  const { team, loading } = useMyCoachCardData(selectedEnrollment?.id, enabled);

  if (!modulesLoading && !enabled) return null;

  return (
    <DashboardCardShell
      icon={Users}
      title={t("cards.myCoach.title")}
      loading={loading || modulesLoading}
    >
      {team.length > 0 ? (
        <ul className="space-y-2" data-testid="coaching-team">
          {team.map((coach) => (
            <li key={coach.id} className="rounded-lg border border-border bg-muted/30 p-3">
              <p className="text-sm font-semibold">{coach.full_name}</p>
              {coach.title && (
                <p className="truncate text-xs text-muted-foreground">{coach.title}</p>
              )}
              <CardFooterLink to={`/coaches/${coach.id}`}>
                {t("cards.myCoach.viewProfile")} <ArrowUpRight className="h-3 w-3" />
              </CardFooterLink>
            </li>
          ))}
        </ul>
      ) : (
        <CardEmptyHint text={t("cards.myCoach.none")} />
      )}
    </DashboardCardShell>
  );
}
