import { useTranslation } from "react-i18next";
import { AlertTriangle, Loader2, Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { useMyTriads } from "@/hooks/triads/useMyTriads";
import { TriadGroupHero } from "./components/TriadGroupHero";
import { TriadSessionCard } from "./components/TriadSessionCard";
import { TriadPastSessionsTable } from "./components/TriadPastSessionsTable";

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

  const activeRounds = rounds.filter((r) => !r.session || r.session.status === "proposed" || r.session.status === "confirmed");
  const pastRounds = rounds.filter((r) => r.session && (r.session.status === "completed" || r.session.status === "cancelled"));

  return (
    <div className="space-y-8">
      <PageHeader eyebrow={t("eyebrow")} title={t("titleLead")} emphasis={t("titleEmphasis")} subtitle={t("subtitle")} />

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
        <>
          {activeRounds.length > 0 && (
            <div className="space-y-6">
              {activeRounds.map((entry) => (
                <div key={entry.group.id} className="animate-rise grid gap-4 lg:grid-cols-2">
                  <TriadGroupHero entry={entry} />
                  <TriadSessionCard entry={entry} />
                </div>
              ))}
            </div>
          )}

          {pastRounds.length > 0 && (
            <div>
              <p className="mb-3 text-[9.5px] font-bold uppercase tracking-[.24em] text-muted-foreground">
                {t("pastSessions.heading")}
              </p>
              <TriadPastSessionsTable rounds={pastRounds} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
