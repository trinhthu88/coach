import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { getOnboardingContent } from "@/lib/onboarding/content";
import { IntroCarousel } from "./IntroCarousel";
import { PointerTour } from "./PointerTour";
import { OnboardingDoneToast } from "./OnboardingDoneToast";
import { trackEvent } from "@/lib/analytics";

type Stage = "intro" | "pointer" | "done" | "closed";

/**
 * Orchestrates the three onboarding stages (intro carousel -> pointer tour -> done
 * toast) for coach/coachee/sponsor.
 *
 * Two mount modes, both handled by the caller (AppLayout.tsx):
 *  - Auto: mounted once per session when profile.onboarding_completed_at is null.
 *    Stays mounted through "done" so the toast fires; harmless once inert.
 *  - Manual ("How it works"): mounted fresh on click, unmounted via onClose when
 *    the user dismisses/finishes, so the next click starts clean from "intro".
 */
export function OnboardingTour({
  role,
  onClose,
  onSetMobileNavOpen,
}: {
  role: "coach" | "coachee" | "sponsor";
  onClose?: () => void;
  onSetMobileNavOpen?: (open: boolean) => void;
}) {
  const { user, refreshProfile } = useAuth();
  const { t } = useTranslation("onboarding");
  const [stage, setStage] = useState<Stage>("intro");
  const content = getOnboardingContent(t, role);

  const markComplete = useCallback(async () => {
    if (!user) return;
    await supabase
      .from("profiles")
      .update({ onboarding_completed_at: new Date().toISOString() })
      .eq("id", user.id);
    refreshProfile();
  }, [user, refreshProfile]);

  const finishIntro = useCallback(() => {
    trackEvent("onboarding_intro_completed", { role, step_count: content.steps.length });
    setStage("pointer");
  }, [role, content.steps.length]);

  const skipIntro = useCallback(() => {
    trackEvent("onboarding_intro_skipped", { role });
    setStage("pointer");
  }, [role]);

  const finishPointerTour = useCallback(() => {
    trackEvent("onboarding_completed", { role, pointer_count: content.pointers.length });
    setStage("done");
    void markComplete();
  }, [role, content.pointers.length, markComplete]);

  const dismissPointerTour = useCallback(() => {
    trackEvent("onboarding_pointer_dismissed", { role });
    void markComplete();
    setStage("closed");
    onClose?.();
  }, [role, markComplete, onClose]);

  const restart = useCallback(() => setStage("intro"), []);

  if (stage === "intro") {
    return <IntroCarousel steps={content.steps} role={role} onFinish={finishIntro} onSkip={skipIntro} />;
  }

  if (stage === "pointer") {
    return (
      <PointerTour
        pointers={content.pointers}
        onFinish={finishPointerTour}
        onDismiss={dismissPointerTour}
        onRestart={restart}
        onSetMobileNavOpen={onSetMobileNavOpen}
      />
    );
  }

  if (stage === "done") {
    return <OnboardingDoneToast onReplay={restart} />;
  }

  return null;
}
