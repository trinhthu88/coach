import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { Sparkles } from "lucide-react";

/**
 * Fires the "onboarding complete" toast once on mount, using the app's existing
 * toast system. Renders nothing itself — the toast portal (<Toaster/> in App.tsx)
 * owns the actual UI.
 */
export function OnboardingDoneToast({ onReplay }: { onReplay: () => void }) {
  const { t } = useTranslation("onboarding");
  const replayRef = useRef(onReplay);
  replayRef.current = onReplay;

  useEffect(() => {
    toast({
      title: t("chrome.doneToast.title"),
      description: t("chrome.doneToast.description"),
      action: (
        <ToastAction altText={t("chrome.doneToast.replayAltText")} onClick={() => replayRef.current()}>
          {t("chrome.doneToast.replay")}
        </ToastAction>
      ),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
