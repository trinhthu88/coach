import { useTranslation } from "react-i18next";
import { UserCircle2, ArrowUpRight } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useProgrammeModules } from "@/hooks/useProgrammeModules";
import { useMyCoachCardData } from "@/hooks/dashboard/useMyCoachCardData";
import { DashboardCardShell, CardFooterLink, CardEmptyHint } from "./shared";

/** "My coach" card — the coachee's single allowlisted coach, with a link to
 * their public profile. Renders nothing if there's no allowlisted coach yet
 * (e.g. an admin hasn't assigned one), same convention as the other cards. */
export function MyCoachCard() {
  const { t } = useTranslation("dashboard");
  const { user } = useAuth();
  const { hasDirection, loading: modulesLoading } = useProgrammeModules();
  const enabled = hasDirection("coaching", "receive");
  const { data: coach, loading } = useMyCoachCardData(user?.id, enabled);

  if (!modulesLoading && !enabled) return null;

  return (
    <DashboardCardShell icon={UserCircle2} title={t("cards.myCoach.title")} loading={loading || modulesLoading}>
      {coach ? (
        <div className="rounded-lg border border-border bg-muted/30 p-3">
          <p className="text-sm font-semibold">{coach.full_name}</p>
          {coach.title && <p className="truncate text-xs text-muted-foreground">{coach.title}</p>}
        </div>
      ) : (
        <CardEmptyHint text={t("cards.myCoach.none")} />
      )}

      {coach && (
        <div className="mt-auto pt-3">
          <CardFooterLink to={`/coaches/${coach.id}`}>
            {t("cards.myCoach.viewProfile")} <ArrowUpRight className="h-3 w-3" />
          </CardFooterLink>
        </div>
      )}
    </DashboardCardShell>
  );
}
