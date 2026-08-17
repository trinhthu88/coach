import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { getOnboardingContent } from "@/lib/onboarding/content";
import { IntroCarousel } from "./IntroCarousel";
import { PointerTour } from "./PointerTour";
import { OnboardingDoneToast } from "./OnboardingDoneToast";

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

  const goToPointerTour = useCallback(() => setStage("pointer"), []);

  const finishPointerTour = useCallback(() => {
    setStage("done");
    void markComplete();
  }, [markComplete]);

  const dismissPointerTour = useCallback(() => {
    void markComplete();
    setStage("closed");
    onClose?.();
  }, [markComplete, onClose]);

  const restart = useCallback(() => setStage("intro"), []);

  if (stage === "intro") {
    return <IntroCarousel steps={content.steps} role={role} onFinish={goToPointerTour} onSkip={goToPointerTour} />;
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
