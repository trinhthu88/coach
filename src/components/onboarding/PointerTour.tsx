import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ChevronRight, RotateCcw, X } from "lucide-react";
import type { OnboardingPointer } from "@/lib/onboarding/content";

const HIGHLIGHT_CLASS = "onboarding-highlight";

export function PointerTour({
  pointers,
  onFinish,
  onDismiss,
  onRestart,
  onSetMobileNavOpen,
}: {
  pointers: OnboardingPointer[];
  onFinish: () => void;
  onDismiss: () => void;
  onRestart: () => void;
  /** Sidebar targets (data-onboarding="nav-…") live inside a Radix Sheet that's
   * unmounted while closed on mobile — this opens/closes it so the target is
   * actually in the DOM and visible to highlight. */
  onSetMobileNavOpen?: (open: boolean) => void;
}) {
  const { t } = useTranslation("onboarding");
  const [index, setIndex] = useState(0);
  const pointer = pointers[index];
  const isLast = index === pointers.length - 1;

  useEffect(() => {
    if (!pointer.targetSelector) return;
    const selector = pointer.targetSelector;
    const isNavTarget = selector.includes('[data-onboarding="nav-');
    let autoOpened = false;
    let retryId: number | undefined;

    const visibleTarget = () =>
      Array.from(document.querySelectorAll<HTMLElement>(selector)).find(
        (el) => el.offsetParent !== null
      ) ?? null;

    const highlight = () => {
      const el = visibleTarget();
      if (!el) {
        // The desktop rail keeps a hidden (display:none) copy of the same
        // data-onboarding node on mobile, so querySelector alone would "find"
        // it without it ever being visible — only the mobile drawer's copy is
        // both mounted and visible there. Open the drawer and retry once.
        if (isNavTarget && onSetMobileNavOpen && !autoOpened) {
          autoOpened = true;
          onSetMobileNavOpen(true);
          retryId = window.setTimeout(highlight, 250);
        }
        return;
      }
      el.classList.add(HIGHLIGHT_CLASS);
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    };

    highlight();

    return () => {
      if (retryId) window.clearTimeout(retryId);
      document
        .querySelectorAll<HTMLElement>(selector)
        .forEach((el) => el.classList.remove(HIGHLIGHT_CLASS));
      if (autoOpened && onSetMobileNavOpen) onSetMobileNavOpen(false);
    };
  }, [pointer.targetSelector, onSetMobileNavOpen]);

  return (
    <div className="fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-secondary shadow-2xl ring-1 ring-white/10">
        {/* Progress bar */}
        <div className="h-0.5 w-full bg-white/10">
          <div
            className="h-full bg-accent transition-all duration-500"
            style={{ width: `${((index + 1) / pointers.length) * 100}%` }}
          />
        </div>

        <div className="p-5">
          {/* Where + count */}
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-micro font-bold uppercase tracking-[0.2em] text-secondary-foreground/50">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
              <span className="truncate">{pointer.where}</span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {/* Step dots */}
              <div className="flex items-center gap-1">
                {pointers.map((_, i) => (
                  <span
                    key={i}
                    className={cn(
                      "h-1 rounded-full transition-all",
                      i === index ? "w-4 bg-accent" : i < index ? "w-1 bg-white/40" : "w-1 bg-white/15"
                    )}
                  />
                ))}
              </div>
              <span className="text-micro text-secondary-foreground/30">
                {index + 1}/{pointers.length}
              </span>
            </div>
          </div>

          {/* Content */}
          <h3 className="font-display text-lg leading-tight text-secondary-foreground">
            {pointer.title}
          </h3>
          <p className="mt-1.5 text-sm2 leading-relaxed text-secondary-foreground/70">
            {pointer.body}
          </p>

          {/* Actions */}
          <div className="mt-4 flex items-center justify-between gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={onRestart}
              className="gap-1.5 text-secondary-foreground/50 hover:bg-white/10 hover:text-secondary-foreground"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {t("chrome.restart")}
            </Button>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onDismiss}
                className="flex items-center gap-1 text-xs text-secondary-foreground/40 transition-colors hover:text-secondary-foreground/70"
              >
                <X className="h-3 w-3" />
                {t("chrome.dismiss")}
              </button>
              <Button
                size="sm"
                className="gap-1.5 bg-accent font-semibold text-accent-foreground hover:bg-accent/90"
                onClick={() => (isLast ? onFinish() : setIndex((i) => i + 1))}
              >
                {isLast ? t("chrome.gotIt") : t("chrome.next")}
                {!isLast && <ChevronRight className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
