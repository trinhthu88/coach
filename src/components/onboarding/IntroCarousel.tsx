import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { OnboardingBullet, OnboardingStep, BulletKind } from "@/lib/onboarding/content";
import type { OnboardingRole } from "@/lib/onboarding/content";
import {
  Compass, Target, Search, CalendarCheck, LockKeyhole, TrendingUp,
  Layers, IdCard, CalendarClock, Users, ShieldAlert, AlertTriangle,
  BarChart2, CalendarRange, UserCheck, ShieldCheck, FileDown,
  CheckCircle2, XCircle, Info, Sparkles, ChevronRight,
} from "lucide-react";

// ─── Per-role, per-step visual context for the left panel ────────────────────

type VisualLine = { icon?: React.ElementType; text: string };

type StepVisual = {
  Icon: React.ElementType;
  metric: string;
  metricSub?: string;
  lines: VisualLine[];
};

const VISUALS: Record<OnboardingRole, StepVisual[]> = {
  coachee: [
    {
      Icon: Compass,
      metric: "Your programme",
      metricSub: "shaped around you",
      lines: [
        { icon: CalendarCheck, text: "Fixed session allowance" },
        { icon: Target, text: "Goals you name yourself" },
        { icon: Search, text: "Coach you choose" },
      ],
    },
    {
      Icon: Target,
      metric: "1 → 10",
      metricSub: "your self-rated scale",
      lines: [
        { icon: Info, text: "Write what you want to change" },
        { icon: Info, text: "Rate it today as a starting line" },
        { icon: TrendingUp, text: "Re-rate whenever something shifts" },
      ],
    },
    {
      Icon: Search,
      metric: "Accredited",
      metricSub: "coach network",
      lines: [
        { icon: CheckCircle2, text: "Filter by focus area & language" },
        { icon: CheckCircle2, text: "Chemistry call doesn't use a session" },
        { icon: CheckCircle2, text: "Switch once, no reason needed" },
      ],
    },
    {
      Icon: CalendarCheck,
      metric: "Live slots",
      metricSub: "real-time availability",
      lines: [
        { icon: Info, text: "Pick a time that suits you" },
        { icon: Info, text: "Auto reminders sent before each session" },
        { icon: Info, text: "Reschedule without email chains" },
      ],
    },
    {
      Icon: LockKeyhole,
      metric: "Closed room",
      metricSub: "session privacy",
      lines: [
        { icon: CheckCircle2, text: "You control what you share" },
        { icon: XCircle, text: "Notes & goal wording never leave" },
        { icon: XCircle, text: "No organisation can access content" },
      ],
    },
    {
      Icon: TrendingUp,
      metric: "Your line",
      metricSub: "progress you claim",
      lines: [
        { icon: Info, text: "Rate each goal yourself" },
        { icon: Info, text: "No external score calculated" },
        { icon: Info, text: "Movement belongs to you" },
      ],
    },
  ],
  coach: [
    {
      Icon: Layers,
      metric: "One surface",
      metricSub: "for your whole practice",
      lines: [
        { icon: Users, text: "Clients you coach" },
        { icon: CalendarClock, text: "Peer practice sessions" },
        { icon: Compass, text: "Your own coaching journey" },
      ],
    },
    {
      Icon: IdCard,
      metric: "Your profile",
      metricSub: "powers the matching",
      lines: [
        { icon: Info, text: "Specialties & bio" },
        { icon: CheckCircle2, text: "Credentials verified once" },
        { icon: Info, text: "Appears on every match card" },
      ],
    },
    {
      Icon: CalendarClock,
      metric: "Weekly blocks",
      metricSub: "published in your timezone",
      lines: [
        { icon: Info, text: "Set once, repeats automatically" },
        { icon: Info, text: "Buffer gaps prevent back-to-back" },
        { icon: Info, text: "Reserve a chemistry-call window" },
      ],
    },
    {
      Icon: Users,
      metric: "Peer exchange",
      metricSub: "give one, receive one",
      lines: [
        { icon: CheckCircle2, text: "Both sessions count toward hours" },
        { icon: CheckCircle2, text: "Find a coach — you're the coachee there" },
        { icon: CheckCircle2, text: "Practice journey tracks everything" },
      ],
    },
    {
      Icon: ShieldAlert,
      metric: "In the room",
      metricSub: "what organisations see",
      lines: [
        { icon: CheckCircle2, text: "Session happened, length, attendance" },
        { icon: XCircle, text: "Notes, recordings, or your name" },
        { icon: Info, text: "Coachee sees only what you mark shared" },
      ],
    },
    {
      Icon: AlertTriangle,
      metric: "Early signals",
      metricSub: "before it's too late",
      lines: [
        { icon: Info, text: "Flat goal ratings surface on your dash" },
        { icon: Info, text: "Long booking gaps are flagged early" },
        { icon: Info, text: "Nudges come from you, not the org" },
      ],
    },
  ],
  sponsor: [
    {
      Icon: BarChart2,
      metric: "Programme health",
      metricSub: "without the content",
      lines: [
        { icon: CheckCircle2, text: "Participation & session usage" },
        { icon: CheckCircle2, text: "Self-rated goal progress" },
        { icon: XCircle, text: "Session notes or goal wording" },
      ],
    },
    {
      Icon: CalendarRange,
      metric: "In context",
      metricSub: "against the window",
      lines: [
        { icon: Info, text: "Month-one low usage is normal" },
        { icon: Info, text: "Month-three flat ratings are not" },
        { icon: Info, text: "All figures read against the timeline" },
      ],
    },
    {
      Icon: UserCheck,
      metric: "Roster",
      metricSub: "status at a glance",
      lines: [
        { icon: Info, text: "Add leaders by email" },
        { icon: Info, text: "One-tap nudge for anyone lagging" },
        { icon: AlertTriangle, text: "At-risk flags appear automatically" },
      ],
    },
    {
      Icon: ShieldCheck,
      metric: "Visible locks",
      metricSub: "you always know what exists",
      lines: [
        { icon: CheckCircle2, text: "Enrolment, attendance, goal growth" },
        { icon: XCircle, text: "Notes, recordings, goal wording" },
        { icon: XCircle, text: "Distributions under 5 leaders suppressed" },
      ],
    },
    {
      Icon: FileDown,
      metric: "Two numbers",
      metricSub: "that renew a programme",
      lines: [
        { icon: TrendingUp, text: "On-track rate — are people showing up?" },
        { icon: TrendingUp, text: "Average goal growth — did anything change?" },
        { icon: Info, text: "Export for any period, with or without roster" },
      ],
    },
  ],
};

// ─── Bullet styles ────────────────────────────────────────────────────────────

const BULLET_STYLES: Record<BulletKind, { box: string; label: string; dot: string }> = {
  in: { box: "border-primary/20 bg-primary-soft", label: "text-primary", dot: "bg-primary" },
  ok: { box: "border-success/25 bg-success/10", label: "text-success", dot: "bg-success" },
  no: { box: "border-warning/30 bg-warning/15", label: "text-warning", dot: "bg-warning" },
};

function BulletRow({ bullet }: { bullet: OnboardingBullet }) {
  const style = BULLET_STYLES[bullet.kind];
  return (
    <li className={cn("flex gap-3 rounded-xl border p-3", style.box)}>
      <span className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", style.dot)} />
      <div>
        <p className={cn("text-[10px] font-bold uppercase tracking-wide", style.label)}>{bullet.label}</p>
        <p className="mt-0.5 text-[12px] leading-relaxed text-foreground/75">{bullet.text}</p>
      </div>
    </li>
  );
}

// ─── Left panel ───────────────────────────────────────────────────────────────

function VisualPanel({ visual, role, index, total }: { visual: StepVisual; role: OnboardingRole; index: number; total: number }) {
  const { Icon, metric, metricSub, lines } = visual;

  return (
    <div className="relative flex flex-col justify-between overflow-hidden bg-secondary p-6 text-secondary-foreground">
      {/* Decorative background circles */}
      <div className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-white/5" />
      <div className="pointer-events-none absolute -bottom-8 -left-8 h-32 w-32 rounded-full bg-white/5" />

      {/* Top: role badge */}
      <div>
        <div className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest text-white/60">
          <Sparkles className="h-2.5 w-2.5" />
          {role === "coachee" ? "Leader" : role === "coach" ? "Coach" : "Sponsor"}
        </div>
      </div>

      {/* Middle: metric + icon card */}
      <div className="my-auto py-6">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/20">
          <Icon className="h-6 w-6 text-accent" />
        </div>
        <p className="font-display text-2xl font-normal leading-tight text-white">{metric}</p>
        {metricSub && <p className="mt-1 text-sm text-white/50">{metricSub}</p>}

        <div className="mt-5 space-y-2.5">
          {lines.map((line, i) => {
            const LIcon = line.icon;
            return (
              <div key={i} className="flex items-start gap-2">
                {LIcon && (
                  <LIcon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0",
                    LIcon === CheckCircle2 ? "text-emerald-400" :
                    LIcon === XCircle ? "text-rose-400" :
                    LIcon === AlertTriangle ? "text-amber-400" :
                    "text-sky-400"
                  )} />
                )}
                <p className="text-[12px] leading-relaxed text-white/70">{line.text}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Bottom: step dots */}
      <div className="flex items-center gap-1.5">
        {Array.from({ length: total }).map((_, i) => (
          <span
            key={i}
            className={cn(
              "h-1 rounded-full transition-all duration-300",
              i === index ? "w-5 bg-accent" : "w-1 bg-white/20"
            )}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function IntroCarousel({
  steps,
  role,
  onFinish,
  onSkip,
}: {
  steps: OnboardingStep[];
  role: OnboardingRole;
  onFinish: () => void;
  onSkip: () => void;
}) {
  const [index, setIndex] = useState(0);
  const step = steps[index];
  const isFirst = index === 0;
  const isLast = index === steps.length - 1;
  const visuals = VISUALS[role];
  const visual = visuals[Math.min(index, visuals.length - 1)];

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onSkip(); }}>
      <DialogContent
        className="max-w-2xl gap-0 overflow-hidden p-0"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogTitle className="sr-only">{step.title}</DialogTitle>

        <div className="grid grid-cols-[220px_1fr] min-h-[480px]">
          {/* Left: visual context */}
          <VisualPanel visual={visual} role={role} index={index} total={steps.length} />

          {/* Right: step content */}
          <div className="flex flex-col">
            <div className="flex-1 overflow-y-auto p-7 pb-4">
              {/* Kicker + count */}
              <div className="mb-4 flex items-center justify-between">
                <p className="eyebrow">{step.kicker}</p>
                <span className="text-[10px] font-medium text-muted-foreground/60">
                  {index + 1} / {steps.length}
                </span>
              </div>

              {/* Title */}
              <h2 className="font-display text-[1.45rem] leading-tight text-foreground">
                {step.title}
              </h2>

              {/* Body */}
              <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
                {step.body}
              </p>

              {/* Bullets */}
              {step.bullets && (
                <ul className="mt-4 space-y-2">
                  {step.bullets.map((bullet, i) => (
                    <BulletRow key={i} bullet={bullet} />
                  ))}
                </ul>
              )}
            </div>

            {/* Footer nav */}
            <div className="flex items-center justify-between border-t border-border px-7 py-4">
              <div>
                {!isFirst && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIndex((i) => i - 1)}
                    className="text-muted-foreground"
                  >
                    Back
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-5">
                <button
                  type="button"
                  onClick={onSkip}
                  className="text-xs text-muted-foreground/60 transition-colors hover:text-muted-foreground hover:underline"
                >
                  Skip intro
                </button>
                <Button
                  size="sm"
                  className="gap-1.5 bg-accent font-semibold text-accent-foreground hover:bg-accent/90"
                  onClick={() => (isLast ? onFinish() : setIndex((i) => i + 1))}
                >
                  {isLast ? "Finish" : "Continue"}
                  {!isLast && <ChevronRight className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
