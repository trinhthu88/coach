import { useEffect, useRef } from "react";
import { toast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";

/**
 * Fires the "onboarding complete" toast once on mount, using the app's existing
 * toast system rather than a bespoke card. Renders nothing itself — the toast
 * portal (<Toaster/> in App.tsx) owns the actual UI.
 */
export function OnboardingDoneToast({ onReplay }: { onReplay: () => void }) {
  // Captured in a ref so the mount-once effect below doesn't need onReplay as a
  // dependency — the caller may pass a new function identity on every render.
  const replayRef = useRef(onReplay);
  replayRef.current = onReplay;

  useEffect(() => {
    toast({
      title: "Onboarding complete",
      description: "You can replay this anytime from “How it works” in the sidebar.",
      action: (
        <ToastAction altText="Replay onboarding tour" onClick={() => replayRef.current()}>
          Replay
        </ToastAction>
      ),
    });
  }, []);

  return null;
}
