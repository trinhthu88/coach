import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import { Handshake, ArrowUpRight, FileCheck2, FileWarning } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useProgrammeModules } from "@/hooks/useProgrammeModules";
import { useMentoringReceiveCardData } from "@/hooks/dashboard/useMentoringCardData";
import { DashboardCardShell, CardFooterLink, CardEmptyHint } from "./shared";

/** "My mentor" card — visible when the programme enables mentoring:receive. */
export function MentoringReceiveCard() {
  const { t } = useTranslation("dashboard");
  const { user } = useAuth();
  const { hasDirection, loading: modulesLoading } = useProgrammeModules();
  const enabled = hasDirection("mentoring", "receive");
  // Fetch fires independently of the programme-modules RPC; `enabled` only
  // gates rendering below (see CoachingReceiveCard for the full rationale).
  const { data, loading } = useMentoringReceiveCardData(user?.id, true);

  if (!modulesLoading && !enabled) return null;

  const s = data.nextSession;

  return (
    <DashboardCardShell icon={Handshake} title={t("cards.mentoringReceive.title")} loading={loading || modulesLoading}>
      {!s ? (
        <CardEmptyHint text={t("cards.mentoringReceive.noUpcoming")} />
      ) : (
        <div className="rounded-lg border border-border bg-muted/30 p-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            {t("cards.mentoringReceive.nextSession")}
          </p>
          <p className="mt-1 truncate text-sm font-semibold">
            {s.mentor?.full_name || t("cards.mentoringReceive.defaultMentor")}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {s.topic} · {format(new Date(s.start_time), "MMM d · p")}
          </p>
          <p
            className={
              "mt-2 inline-flex items-center gap-1 text-xs font-semibold " +
              (s.prepFileUploaded ? "text-success" : "text-warning")
            }
          >
            {s.prepFileUploaded ? <FileCheck2 className="h-3.5 w-3.5" /> : <FileWarning className="h-3.5 w-3.5" />}
            {s.prepFileUploaded ? t("cards.mentoringReceive.prepUploaded") : t("cards.mentoringReceive.prepMissing")}
          </p>
        </div>
      )}

      <div className="mt-auto pt-3">
        <CardFooterLink to="/mentoring">
          {t("cards.mentoringReceive.openMentoring")} <ArrowUpRight className="h-3 w-3" />
        </CardFooterLink>
      </div>
    </DashboardCardShell>
  );
}
