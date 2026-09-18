import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useMyTriads } from "@/hooks/triads/useMyTriads";
import { TriadGroupHero } from "./components/TriadGroupHero";
import { TriadSessionCard } from "./components/TriadSessionCard";

/**
 * Detail destination for a row in the unified Sessions list.
 *
 * Triads have different canonical actions from coaching/peer/mentoring
 * sessions, so they intentionally keep the existing Triad workflow instead of
 * being forced through the generic session detail hooks.
 */
export default function TriadSessionDetail() {
  const { t } = useTranslation("triads");
  const { sessionId } = useParams<{ sessionId: string }>();
  const { rounds, loading, error, refetch } = useMyTriads();
  const entry = rounds.find((round) => round.session?.id === sessionId);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !entry) {
    return (
      <Card className="mx-auto max-w-xl p-12 text-center">
        <p className="text-sm text-muted-foreground">{t("reflection.notFound")}</p>
        <div className="mt-5 flex justify-center gap-2">
          {error && (
            <Button variant="outline" onClick={() => refetch()}>
              {t("retry")}
            </Button>
          )}
          <Button asChild variant="outline">
            <Link to="/sessions">{t("sessionDetail.backToSessions")}</Link>
          </Button>
        </div>
      </Card>
    );
  }

  const completed = entry.session?.status === "completed";

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Link
        to="/sessions"
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-primary"
      >
        <ArrowLeft className="h-4 w-4" /> {t("sessionDetail.backToSessions")}
      </Link>

      <div>
        <p className="text-[9.5px] font-bold uppercase tracking-[.22em] text-primary">{t("eyebrow")}</p>
        <h1 className="font-display mt-2 text-[1.9rem] leading-[1.08] tracking-[-0.02em]">
          {entry.round.title || t("roundLabel", { n: entry.round.round_number })}
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{t("sessionDetail.subtitle")}</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <TriadGroupHero entry={entry} />
        <TriadSessionCard entry={entry} />
      </div>

      {completed && entry.session && (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div>
            <p className="font-semibold">{t("sessionDetail.reflectionPrompt")}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t("sessionDetail.reflectionSubtitle")}</p>
          </div>
          <Button asChild>
            <Link to={`/triads/${entry.session.id}/reflect`}>
              {entry.reflectionSubmitted ? t("session.viewReflections") : t("session.submitReflection")}
            </Link>
          </Button>
        </Card>
      )}
    </div>
  );
}