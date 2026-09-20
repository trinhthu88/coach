import { useTranslation } from "react-i18next";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Loader2, AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";
import { getFriendlyErrorMessage } from "@/lib/errors";
import { useEligiblePeerPartners } from "@/hooks/peer/useEligiblePeerPartners";
import { MyPeerPracticeSection } from "@/pages/coachee/MyPeerPracticeSection";
import { useModuleWorkspace } from "@/hooks/journey/useModuleWorkspace";
import { useLearnerFeedback } from "@/hooks/dashboard/useLearnerFeedback";
import { feedbackText } from "@/lib/feedbackLabels";
import { formatProfileDate } from "@/lib/programmeProfile";
import {
  ModuleCard,
  ModuleEyebrow,
  ModuleFeedbackQuote,
  ModulePageHeader,
  ModulePrimaryAction,
  ModuleProgressCard,
} from "@/components/programme/module/ModulePage";

/**
 * The learner's Peer workspace: who they may practise with, and every session
 * they are part of.
 *
 * Both halves are canonical and both are scoped to the SELECTED ENROLLMENT.
 * The partner pool is eligible_peer_partners(), which applies the cohort rule
 * -- own cohort plus the cohorts an Admin has explicitly allowed it to reach.
 * It replaces a direct `profiles` query on peer_coaching_opt_in, which is a
 * global flag: that listed every opted-in learner in the system regardless of
 * cohort, programme or organisation, and could not say whether a candidate was
 * still enrolled.
 *
 * Sessions come from learner_session_history through useModuleWorkspace, the
 * same projection the Dashboard, the Sessions list and the Programme Journey
 * read, so "Peer progress exists but the Peer page shows nothing" cannot
 * happen: there is one list, partitioned for display, never re-derived.
 */
export default function CoacheePeerPractice() {
  const { user } = useAuth();
  const { t } = useTranslation("profile");
  const { t: tDash } = useTranslation("dashboard");
  const ws = useModuleWorkspace("peer");
  // Latest learner-visible peer feedback, from the one learner feedback source.
  const feedback = useLearnerFeedback(user?.id, ws.enrollmentId);
  const latestFeedback =
    feedback.feedback.find((f) => f.kind === "peer_competency" || (f.kind === "session_note" && f.source === "peer_practice")) ?? null;
  const partners = useEligiblePeerPartners(ws.enrollmentId);
  const loading = ws.enrollmentLoading || partners.isLoading;
  const error = partners.error ? getFriendlyErrorMessage(partners.error, t) : null;
  const rows = partners.data ?? [];

  return (
    <div className="flex flex-col gap-[18px]">
      <ModulePageHeader
        title={tDash("learnerModules.peer.title")}
        subtitle={tDash("learnerModules.peer.subtitle")}
        action={<ModulePrimaryAction href="#peer-partners">{tDash("learnerModules.peer.book")}</ModulePrimaryAction>}
      />

      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(290px,1fr))]">
        {/* The practice pool is partner ELIGIBILITY -- who this enrollment may
            book right now under the cohort rule. It is not session history,
            and an empty pool never means "you have no peer sessions". */}
        <ModuleCard id="peer-partners" testId="peer-partners">
          <ModuleEyebrow>{t("coacheePeerPractice.partnersTitle")}</ModuleEyebrow>
          <p className="mb-[14px] mt-2 text-[11.5px] text-[#7d7468]">{t("coacheePeerPractice.partnersSubtitle")}</p>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : error ? (
            <div role="alert" className="flex flex-col items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center text-sm">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              <p className="text-muted-foreground">{error}</p>
              <Button size="sm" variant="outline" onClick={() => partners.refetch()}>
                {t("coacheePeerPractice.retry")}
              </Button>
            </div>
          ) : rows.length === 0 ? (
            <p className="rounded-xl border border-dashed border-[#ddd6cc] bg-[#fbf8f2] p-4 text-[11.5px] leading-relaxed text-[#7d7468]">
              {t("coacheePeerPractice.empty")}
            </p>
          ) : (
            <div className="flex flex-col gap-[9px]">
              {rows.map((c) => (
                <div
                  key={c.userId}
                  data-testid="peer-partner-row"
                  data-own-cohort={c.isOwnCohort ? "true" : "false"}
                  className="flex items-center justify-between gap-3 rounded-[12px] border border-[#efeae1] bg-white px-[13px] py-3"
                >
                  <div className="flex min-w-0 items-center gap-[11px]">
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-[#e4f1f5] text-[11px] font-bold text-[#226d80]">
                      {(c.displayName || "?").split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-[12px] font-semibold text-[#062f3e]">{c.displayName}</div>
                      {/* Which cohort a partner comes from is the one piece of
                          context that makes a cross-cohort pool legible. */}
                      <div className="mt-0.5 truncate text-[10px] text-[#7d7468]">
                        {c.isOwnCohort
                          ? t("coacheePeerPractice.ownCohort")
                          : t("coacheePeerPractice.otherCohort", { cohort: c.cohortName })}
                      </div>
                    </div>
                  </div>
                  <Link
                    to={`/coachee/peer-practice/${c.userId}/book`}
                    className="shrink-0 rounded-full border border-[#d8d1c6] px-[13px] py-2 text-[10.5px] font-bold text-[#062f3e] hover:border-[#8bd3e3]"
                  >
                    {t("coacheePeerPractice.book")}
                  </Link>
                </div>
              ))}
            </div>
          )}
        </ModuleCard>

        <div className="flex flex-col gap-4">
          <ModuleProgressCard
            completed={ws.completed}
            required={ws.required}
            label={tDash("learnerModules.peer.progressLabel")}
            loading={ws.progressLoading}
          />
          <ModuleFeedbackQuote
            eyebrow={tDash("learnerModules.peer.feedbackTitle")}
            quote={latestFeedback ? feedbackText(latestFeedback) : null}
            byline={latestFeedback ? [latestFeedback.fromName, formatProfileDate(latestFeedback.submittedAt)].filter(Boolean).join(" · ") : undefined}
            empty={feedback.error ? tDash("learnerProfile.errors.feedback") : tDash("learnerModules.peer.noFeedback")}
          />
        </div>
      </div>

      <MyPeerPracticeSection />
    </div>
  );
}
