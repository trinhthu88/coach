import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Loader2, AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";
import { getFriendlyErrorMessage } from "@/lib/errors";
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

interface PeerCoachee {
  id: string;
  full_name: string;
  avatar_url: string | null;
}

/**
 * Coachee equivalent of CoachPeerCoaching.tsx — same structure, sourcing
 * candidates from profiles.peer_coaching_opt_in (coachee-role rows) instead
 * of coach_profiles.peer_coaching_opt_in. A separate, open opt-in pool from
 * the coach one (RULES.md §3) — not merged.
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
  const [coachees, setCoachees] = useState<PeerCoachee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    const { data, error: fetchError } = await supabase
      .from("profiles")
      .select("id, full_name, avatar_url")
      .eq("peer_coaching_opt_in", true)
      .neq("id", user.id);
    if (fetchError) {
      setError(getFriendlyErrorMessage(fetchError, t));
      setLoading(false);
      return;
    }
    setCoachees((data || []) as PeerCoachee[]);
    setLoading(false);
  }, [user, t]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="flex flex-col gap-[18px]">
      <ModulePageHeader
        title={tDash("learnerModules.peer.title")}
        subtitle={tDash("learnerModules.peer.subtitle")}
        action={<ModulePrimaryAction href="#peer-partners">{tDash("learnerModules.peer.book")}</ModulePrimaryAction>}
      />

      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(290px,1fr))]">
        {/* Practice pool = partner AVAILABILITY (profiles opted in to peer
            practice) — who can be booked now. Not session history. */}
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
              <Button size="sm" variant="outline" onClick={load}>
                {t("coacheePeerPractice.retry")}
              </Button>
            </div>
          ) : coachees.length === 0 ? (
            <p className="rounded-xl border border-dashed border-[#ddd6cc] bg-[#fbf8f2] p-4 text-[11.5px] leading-relaxed text-[#7d7468]">
              {t("coacheePeerPractice.empty")}
            </p>
          ) : (
            <div className="flex flex-col gap-[9px]">
              {coachees.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-3 rounded-[12px] border border-[#efeae1] bg-white px-[13px] py-3">
                  <div className="flex min-w-0 items-center gap-[11px]">
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-[#e4f1f5] text-[11px] font-bold text-[#226d80]">
                      {(c.full_name || "?").split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-[12px] font-semibold text-[#062f3e]">{c.full_name}</div>
                      <div className="mt-0.5 text-[10px] text-[#7d7468]">{t("coacheePeerPractice.defaultTitle")}</div>
                    </div>
                  </div>
                  <Link
                    to={`/coachee/peer-practice/${c.id}/book`}
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
