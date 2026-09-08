import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import { Handshake, ArrowUpRight } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useProgrammeModules } from "@/hooks/useProgrammeModules";
import { useMentoringGiveCardData } from "@/hooks/dashboard/useMentoringCardData";
import { DashboardCardShell, CardMetricRow, CardFooterLink, CardEmptyHint } from "./shared";

/** "My mentees" card — visible when the programme enables mentoring:give. */
export function MentoringGiveCard() {
  const { t } = useTranslation("dashboard");
  const { user } = useAuth();
  const { hasDirection, loading: modulesLoading } = useProgrammeModules();
  const enabled = hasDirection("mentoring", "give");
  // Fetch fires independently of the programme-modules RPC; `enabled` only
  // gates rendering below (see CoachingReceiveCard for the full rationale).
  const { data, loading } = useMentoringGiveCardData(user?.id, true);

  if (!modulesLoading && !enabled) return null;

  return (
    <DashboardCardShell icon={Handshake} title={t("cards.mentoringGive.title")} loading={loading || modulesLoading}>
      {data.upcoming.length === 0 ? (
        <CardEmptyHint text={t("cards.mentoringGive.noUpcoming")} />
      ) : (
        <ul className="space-y-2">
          {data.upcoming.map((s) => (
            <li key={s.id} className="rounded-lg border border-border bg-muted/30 p-2.5">
              <p className="truncate text-sm font-semibold">{s.mentee || t("cards.mentoringGive.defaultMentee")}</p>
              <p className="truncate text-xs text-muted-foreground">
                {s.topic} · {format(new Date(s.start_time), "MMM d · p")}
              </p>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3">
        <CardMetricRow label={t("cards.mentoringGive.menteeCount")} value={data.menteeCount} />
        <CardMetricRow label={t("cards.mentoringGive.sessionsDelivered")} value={data.sessionsDelivered} />
      </div>

      <div className="mt-auto pt-3">
        <CardFooterLink to="/mentoring">
          {t("cards.mentoringGive.openMentoring")} <ArrowUpRight className="h-3 w-3" />
        </CardFooterLink>
      </div>
    </DashboardCardShell>
  );
}
