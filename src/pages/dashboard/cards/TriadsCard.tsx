import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import { Users, ArrowUpRight, MessageSquareQuote } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/context/AuthContext";
import { useProgrammeModules } from "@/hooks/useProgrammeModules";
import { useTriadsCardData } from "@/hooks/dashboard/useTriadsCardData";
import { DashboardCardShell, CardFooterLink, CardEmptyHint } from "./shared";

/** "Triads" card — next session (propose/accept flow) + pending reflections. */
export function TriadsCard() {
  const { t } = useTranslation("dashboard");
  const { user } = useAuth();
  const { hasModule, loading: modulesLoading } = useProgrammeModules();
  const enabled = hasModule("triads");
  const { data, loading } = useTriadsCardData(user?.id, enabled);

  if (!modulesLoading && !enabled) return null;

  return (
    <DashboardCardShell
      icon={Users}
      title={t("cards.triads.title")}
      loading={loading || modulesLoading}
      badge={
        data.pendingReflections > 0 ? (
          <Badge className="bg-warning/15 text-warning hover:bg-warning/15">
            {t("cards.triads.reflectionsBadge", { count: data.pendingReflections })}
          </Badge>
        ) : undefined
      }
    >
      {!data.nextSession ? (
        <CardEmptyHint text={t("cards.triads.noUpcoming")} />
      ) : (
        <div className="rounded-lg border border-border bg-muted/30 p-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            {data.nextSession.status === "confirmed" ? t("cards.triads.confirmed") : t("cards.triads.proposed")}
          </p>
          <p className="mt-1 text-sm font-semibold">
            {data.nextSession.proposed_start_time
              ? format(new Date(data.nextSession.proposed_start_time), "MMM d · p")
              : t("cards.triads.timeTbd")}
          </p>
          {data.nextSession.myResponse === "pending" && (
            <p className="mt-1 text-xs font-semibold text-warning">{t("cards.triads.awaitingYourResponse")}</p>
          )}
        </div>
      )}

      {data.pendingReflections > 0 && (
        <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <MessageSquareQuote className="h-3.5 w-3.5" />
          {t("cards.triads.reflectionsPending", { count: data.pendingReflections })}
        </p>
      )}

      <div className="mt-auto pt-3">
        <CardFooterLink to="/triads">
          {t("cards.triads.openTriads")} <ArrowUpRight className="h-3 w-3" />
        </CardFooterLink>
      </div>
    </DashboardCardShell>
  );
}
