import { useTranslation } from "react-i18next";
import { AlertTriangle, Loader2, Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { useAuth } from "@/context/AuthContext";
import { useEnrollmentContext } from "@/hooks/useEnrollmentContext";
import { useMyTriads } from "@/hooks/triads/useMyTriads";
import { useEnrollmentSessions } from "@/hooks/journey/useEnrollmentSessions";
import { useLearnerCanonicalProgress } from "@/hooks/useLearnerCanonicalProgress";
import { DevelopmentSessionsList } from "@/pages/journey/DevelopmentSessionsList";
import { TriadGroupHero } from "./components/TriadGroupHero";
import { TriadSessionCard } from "./components/TriadSessionCard";

/**
 * Triads workspace — two different facts, kept apart:
 *  1. Current triad rounds: admin-configured rounds the learner is grouped
 *     into that are still open (useMyTriads — triad_groups ⋈ triad_rounds).
 *     "No open round" is a statement about configuration only.
 *  2. My triad sessions: every triad session record in the learner's
 *     enrollment with its real status (learner_session_history), including
 *     sessions from groups that pre-date configured rounds. Module progress
 *     (Triads x/y) is quoted from the canonical progress row alongside.
 */
export default function TriadsPage() {
  const { t } = useTranslation("triads");
  const { user } = useAuth();
  const { selectedEnrollment } = useEnrollmentContext(user?.id);
  const enrollmentId = selectedEnrollment?.id;
  const { rounds, loading, error, refetch } = useMyTriads();
  const history = useEnrollmentSessions(enrollmentId, user?.id);
  const { progress } = useLearnerCanonicalProgress(enrollmentId);

  const openRounds = rounds.filter((r) => !r.session || r.session.status === "proposed" || r.session.status === "confirmed");
  const triadSessions = history.sessions.filter((s) => s.type === "triad");

  return (
    <div className="space-y-8">
      <PageHeader eyebrow={t("eyebrow")} title={t("titleLead")} emphasis={t("titleEmphasis")} subtitle={t("subtitle")} />

      <section data-testid="triad-current-rounds" className="space-y-4">
        <h2 className="font-display text-lg">{t("currentRounds.title")}</h2>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : error ? (
          <Card className="flex flex-col items-center gap-3 border-destructive/30 bg-destructive/5 p-10 text-center text-sm">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <p className="text-muted-foreground">{t("loadError")}</p>
            <Button size="sm" variant="outline" onClick={() => refetch()}>
              {t("retry")}
            </Button>
          </Card>
        ) : openRounds.length === 0 ? (
          <Card className="flex flex-col items-center gap-2 p-10 text-center">
            <Users className="mb-1 h-7 w-7 text-muted-foreground/50" />
            <h3 className="text-base font-semibold">{t("currentRounds.noneTitle")}</h3>
            <p className="text-sm text-muted-foreground">{t("currentRounds.noneBody")}</p>
          </Card>
        ) : (
          <div className="space-y-6">
            {openRounds.map((entry) => (
              <div key={entry.group.id} className="animate-rise grid gap-4 lg:grid-cols-2">
                <TriadGroupHero entry={entry} />
                <TriadSessionCard entry={entry} />
              </div>
            ))}
          </div>
        )}
      </section>

      <section data-testid="triad-history" className="space-y-3">
        <div>
          <h2 className="font-display text-lg">{t("history.title")}</h2>
          {progress && (
            <p className="mt-0.5 text-[11.5px] text-muted-foreground">
              {t("history.progress", { completed: progress.triad_completed_units, required: progress.triad_required_units })}
            </p>
          )}
        </div>
        {history.loading ? (
          <div className="h-16 animate-pulse rounded-lg bg-muted/50" />
        ) : history.error ? (
          <Card role="alert" className="border-destructive/30 bg-destructive/5 p-5 text-center text-sm text-destructive">
            {t("history.loadError")}
          </Card>
        ) : triadSessions.length === 0 ? (
          <Card className="p-5 text-center text-sm text-muted-foreground">{t("history.empty")}</Card>
        ) : (
          <DevelopmentSessionsList
            sessions={triadSessions}
            programmeName={progress?.programme_label ?? null}
            cohortName={progress?.cohort_label ?? null}
          />
        )}
      </section>
    </div>
  );
}
