import { useEffect, useRef } from "react";
import { toast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { Sparkles } from "lucide-react";

/**
 * Fires the "onboarding complete" toast once on mount, using the app's existing
 * toast system. Renders nothing itself — the toast portal (<Toaster/> in App.tsx)
 * owns the actual UI.
 */
export function OnboardingDoneToast({ onReplay }: { onReplay: () => void }) {
  const replayRef = useRef(onReplay);
  replayRef.current = onReplay;

  useEffect(() => {
    toast({
      title: "Onboarding complete.",
      description: 'You can replay this anytime from "How it works" in the sidebar.',
      action: (
        <ToastAction altText="Replay onboarding tour" onClick={() => replayRef.current()}>
          Replay
        </ToastAction>
      ),
    });
  }, []);

  return null;
}
