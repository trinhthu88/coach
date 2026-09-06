import { useTranslation } from "react-i18next";
import { AlertTriangle, Loader2, Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { format } from "date-fns";
import { useMyTriads } from "@/hooks/triads/useMyTriads";
import { TriadSessionCard } from "./components/TriadSessionCard";

function initials(name: string) {
  return (name || "?").split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
}

export default function TriadsPage() {
  const { t } = useTranslation("triads");
  const { rounds, loading, error, refetch } = useMyTriads();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} subtitle={t("subtitle")} />

      {error ? (
        <Card className="flex flex-col items-center gap-3 border-destructive/30 bg-destructive/5 p-12 text-center text-sm">
          <AlertTriangle className="h-5 w-5 text-destructive" />
          <p className="text-muted-foreground">{t("loadError")}</p>
          <Button size="sm" variant="outline" onClick={() => refetch()}>
            {t("retry")}
          </Button>
        </Card>
      ) : rounds.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 p-12 text-center">
          <Users className="mb-2 h-8 w-8 text-muted-foreground/50" />
          <h2 className="text-lg font-semibold">{t("noRoundsTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("noRoundsBody")}</p>
        </Card>
      ) : (
        <div className="space-y-6">
          {rounds.map((entry) => (
            <div key={entry.group.id} className="space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <p className="font-display text-xl font-normal tracking-tight">
                    {t("roundLabel", { n: entry.round.round_number })} — {entry.round.title}
                  </p>
                  {entry.round.training_weeks && (
                    <p className="text-xs text-muted-foreground">{entry.round.training_weeks.title}</p>
                  )}
                </div>
                <p className="text-xs font-semibold text-muted-foreground">
                  {t("deadlineLabel")}: {format(new Date(`${entry.round.completion_deadline}T00:00:00`), "MMM d, yyyy")}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                {entry.members.map((m) => (
                  <span key={m.id} className="inline-flex items-center gap-2 rounded-full bg-muted/50 px-3 py-1.5 text-[12.5px]">
                    <span className="grid h-6 w-6 shrink-0 place-items-center overflow-hidden rounded-full bg-primary-soft text-[10px] font-bold text-primary">
                      {m.avatar_url ? <img src={m.avatar_url} alt={m.full_name} className="h-full w-full object-cover" /> : initials(m.full_name)}
                    </span>
                    {m.full_name}
                  </span>
                ))}
              </div>
              {!entry.group.member_3_id && <p className="text-xs italic text-muted-foreground">{t("dyadNote")}</p>}

              <TriadSessionCard entry={entry} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
