import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { OnboardingPointer } from "@/lib/onboarding/content";

const HIGHLIGHT_CLASS = "onboarding-highlight";

export function PointerTour({
  pointers,
  onFinish,
  onDismiss,
  onRestart,
}: {
  pointers: OnboardingPointer[];
  onFinish: () => void;
  onDismiss: () => void;
  onRestart: () => void;
}) {
  const [index, setIndex] = useState(0);
  const pointer = pointers[index];
  const isLast = index === pointers.length - 1;

  useEffect(() => {
    if (!pointer.targetSelector) return;
    const el = document.querySelector<HTMLElement>(pointer.targetSelector);
    if (!el) return;
    el.classList.add(HIGHLIGHT_CLASS);
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    return () => el.classList.remove(HIGHLIGHT_CLASS);
  }, [pointer.targetSelector]);

  return (
    <div className="fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
      <div className="w-full max-w-md rounded-2xl bg-secondary p-6 text-secondary-foreground shadow-2xl ring-1 ring-white/10">
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-secondary-foreground/60">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
          <span className="truncate">{pointer.where}</span>
          <span className="ml-auto shrink-0 normal-case tracking-normal text-secondary-foreground/40">
            {index + 1} of {pointers.length}
          </span>
        </div>
        <h3 className="font-display mt-3 text-xl leading-tight text-secondary-foreground">{pointer.title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-secondary-foreground/75">{pointer.body}</p>

        <div className="mt-5 flex items-center justify-between gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={onRestart}
            className="text-secondary-foreground/60 hover:bg-white/10 hover:text-secondary-foreground"
          >
            Restart tour
          </Button>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={onDismiss}
              className="text-xs text-secondary-foreground/60 transition-colors hover:text-secondary-foreground hover:underline"
            >
              Dismiss
            </button>
            <Button
              size="sm"
              className="bg-accent font-semibold text-accent-foreground hover:bg-accent/90"
              onClick={() => (isLast ? onFinish() : setIndex((i) => i + 1))}
            >
              {isLast ? "Got it" : "Next"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
