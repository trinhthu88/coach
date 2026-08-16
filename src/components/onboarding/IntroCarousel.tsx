import { useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { OnboardingBullet, OnboardingStep, BulletKind } from "@/lib/onboarding/content";

const BULLET_STYLES: Record<BulletKind, { box: string; label: string }> = {
  in: { box: "border-primary/20 bg-primary-soft", label: "text-primary" },
  ok: { box: "border-success/25 bg-success/10", label: "text-success" },
  no: { box: "border-warning/30 bg-warning/15", label: "text-warning" },
};

function BulletRow({ bullet }: { bullet: OnboardingBullet }) {
  const style = BULLET_STYLES[bullet.kind];
  return (
    <li className={cn("rounded-lg border p-3", style.box)}>
      <p className={cn("text-[10px] font-bold uppercase tracking-wide", style.label)}>{bullet.label}</p>
      <p className="mt-1 text-sm text-foreground/80">{bullet.text}</p>
    </li>
  );
}

export function IntroCarousel({
  steps,
  onFinish,
  onSkip,
}: {
  steps: OnboardingStep[];
  onFinish: () => void;
  onSkip: () => void;
}) {
  const [index, setIndex] = useState(0);
  const step = steps[index];
  const isFirst = index === 0;
  const isLast = index === steps.length - 1;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onSkip(); }}>
      <DialogContent className="max-w-lg gap-0 overflow-hidden p-0" onInteractOutside={(e) => e.preventDefault()}>
        <div className="p-8 pb-6">
          <DialogTitle className="sr-only">{step.title}</DialogTitle>
          <p className="eyebrow">{step.kicker}</p>
          <h2 className="font-display mt-3 text-2xl leading-tight text-foreground sm:text-[1.65rem]">
            {step.title}
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
          {step.bullets && (
            <ul className="mt-5 space-y-2">
              {step.bullets.map((bullet, i) => (
                <BulletRow key={i} bullet={bullet} />
              ))}
            </ul>
          )}
        </div>

        <div className="flex justify-center gap-1.5 pb-5">
          {steps.map((_, i) => (
            <span
              key={i}
              className={cn(
                "h-1.5 rounded-full transition-all",
                i === index ? "w-6 bg-primary" : "w-1.5 bg-muted"
              )}
            />
          ))}
        </div>

        <DialogFooter className="flex-row items-center justify-between border-t border-border px-8 py-4 sm:justify-between">
          <div>
            {!isFirst && (
              <Button variant="ghost" size="sm" onClick={() => setIndex((i) => i - 1)}>
                Back
              </Button>
            )}
          </div>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={onSkip}
              className="text-xs text-muted-foreground transition-colors hover:text-foreground hover:underline"
            >
              Skip intro
            </button>
            <Button
              size="sm"
              className="bg-accent font-semibold text-accent-foreground hover:bg-accent/90"
              onClick={() => (isLast ? onFinish() : setIndex((i) => i + 1))}
            >
              {isLast ? "Finish" : "Continue"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
