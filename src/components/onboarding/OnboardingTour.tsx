import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/context/AuthContext";
import { persistOnboardingCompletion } from "@/lib/onboarding/persistCompletion";
import { getOnboardingContent } from "@/lib/onboarding/content";
import { IntroCarousel } from "./IntroCarousel";
import { PointerTour } from "./PointerTour";
import { OnboardingDoneToast } from "./OnboardingDoneToast";
import { trackEvent } from "@/lib/analytics";
import { toast } from "sonner";

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

  // profiles.onboarding_completed_at is the only record that the walkthrough
  // was seen — per user, in the database, so it holds across devices and
  // sessions. Written once, the first time the user finishes OR dismisses any
  // stage: leaving the intro (finished or skipped/closed) already counts, so
  // closing the tab during the pointer tour cannot bring it back next login.
  // persistOnboardingCompletion retries by itself (it outlives this component,
  // which unmounts when the last step is dismissed); a save that still fails is
  // reported, never swallowed, and the next stage change tries again.
  const persistedRef = useRef(false);
  const markComplete = useCallback(async () => {
    if (!user || persistedRef.current) return;
    persistedRef.current = true;
    const result = await persistOnboardingCompletion(user.id);
    if (!result.ok) {
      persistedRef.current = false;
      console.error("Could not record onboarding completion", result.error);
      toast.error(t("saveFailed"));
      return;
    }
    refreshProfile();
  }, [user, refreshProfile, t]);

  const finishIntro = useCallback(() => {
    trackEvent("onboarding_intro_completed", { role, step_count: content.steps.length });
    void markComplete();
    setStage("pointer");
  }, [role, content.steps.length, markComplete]);

  const skipIntro = useCallback(() => {
    trackEvent("onboarding_intro_skipped", { role });
    void markComplete();
    setStage("pointer");
  }, [role, markComplete]);

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
