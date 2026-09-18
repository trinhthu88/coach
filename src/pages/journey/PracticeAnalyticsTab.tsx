import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import { Info } from "lucide-react";
import { Card } from "@/components/ui/card";
import { usePracticeAnalytics } from "@/hooks/journey/usePracticeAnalytics";

/**
 * The approved prototype's "Practice & Competency Analytics" tab — the
 * useful ICF competency evidence Practice Journey already tracked,
 * integrated into My Journey rather than kept as a competing top-level
 * destination (see AppLayout's coachee nav — Practice Journey stays reachable
 * for real analytics continuity, but is no longer a primary destination).
 *
 * Competency scores come only from peer_session_competency_feedback (via
 * usePracticeAnalytics, shared with the standalone Practice Journey page) —
 * triad_reflections has no per-competency breakdown (only a single overall
 * satisfaction_rating), so it cannot honestly contribute a competency score
 * here. selfReflectionsCount is passed in from the same
 * useEnrollmentDevelopmentJourney projection the Reflections tab reads,
 * never a second reflection query.
 */
export function PracticeAnalyticsTab({
  enrollmentId,
  userId,
  selfReflectionsCount,
  onViewReflections,
  onViewFeedback,
}: {
  enrollmentId: string | undefined;
  userId: string | undefined;
  selfReflectionsCount: number;
  onViewReflections: () => void;
  onViewFeedback: () => void;
}) {
  const { t } = useTranslation("journey");
  const { t: tDash } = useTranslation("dashboard");
  const { loading, feedback, profilesById, stats, competencyScores } = usePracticeAnalytics(enrollmentId, userId);

  const peerSessionsCompleted = stats.peerGiven.completed + stats.peerReceived.completed;
  const observedCount = competencyScores.filter((c) => c.score != null).length;
  const recentEvidence = [...feedback].reverse().slice(0, 5);

  if (loading) {
    return <div className="h-40 animate-pulse rounded-lg bg-muted/50" />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2.5 rounded-xl border border-primary/20 bg-primary-soft/40 p-3.5 text-[11px] text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <p>{t("practiceAnalyticsTab.scopeNotice")}</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
        <Card className="p-5">
          <p className="font-display text-lg">{t("practiceAnalyticsTab.competencyList.title")}</p>
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">{t("practiceAnalyticsTab.competencyList.subtitle")}</p>

          <div className="mt-4 grid grid-cols-3 gap-3 border-b border-border pb-4">
            <Stat value={String(peerSessionsCompleted)} label={t("practiceAnalyticsTab.kpis.peerSessions")} />
            <Stat value={String(observedCount)} label={t("practiceAnalyticsTab.kpis.competenciesObserved")} />
            <Stat value={String(selfReflectionsCount)} label={t("practiceAnalyticsTab.kpis.selfReflections")} />
          </div>

          {observedCount === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">{t("practiceAnalyticsTab.competencyList.empty")}</p>
          ) : (
            <div className="mt-4 space-y-3">
              {competencyScores
                .filter((c) => c.score != null)
                .map((c) => (
                  <div key={c.key} className="flex items-center gap-3">
                    <div className="w-[160px] shrink-0">
                      <p className="truncate text-[11px] font-semibold">{tDash(`practiceJourney.competencies.${c.key}`)}</p>
                      <p className="truncate text-[9px] text-muted-foreground">{t("practiceAnalyticsTab.competencyList.sub")}</p>
                    </div>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, c.score ?? 0))}%` }} />
                    </div>
                    <p className="w-10 shrink-0 text-right font-display text-sm text-primary">{c.score}</p>
                  </div>
                ))}
            </div>
          )}
        </Card>

        <Card className="p-5">
          <p className="font-display text-lg">{t("practiceAnalyticsTab.evidence.title")}</p>
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">{t("practiceAnalyticsTab.evidence.subtitle")}</p>

          {recentEvidence.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">{t("practiceAnalyticsTab.evidence.empty")}</p>
          ) : (
            <div className="mt-4 space-y-2">
              {recentEvidence.map((f) => (
                <div key={f.id} className="rounded-lg border border-border bg-muted/20 px-3 py-2">
                  <p className="text-[11px] font-semibold">
                    {profilesById[f.peer_coachee_id]?.full_name ?? tDash("practiceJourney.defaultPeer")}
                  </p>
                  <p className="text-[9.5px] text-muted-foreground">{format(new Date(f.created_at), "MMM d, yyyy")}</p>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
            <button
              type="button"
              onClick={onViewReflections}
              className="rounded-lg border border-border bg-card px-3 py-1.5 text-[11px] font-semibold transition-colors hover:border-primary/40"
            >
              {t("practiceAnalyticsTab.viewReflections")}
            </button>
            <button
              type="button"
              onClick={onViewFeedback}
              className="rounded-lg border border-border bg-card px-3 py-1.5 text-[11px] font-semibold transition-colors hover:border-primary/40"
            >
              {t("practiceAnalyticsTab.viewFeedback")}
            </button>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <p className="font-display text-xl">{value}</p>
      <p className="mt-1 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
    </div>
  );
}
