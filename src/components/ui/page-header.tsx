import { ReactNode } from "react";
import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Clariva page header — uppercase eyebrow, oversized Fraunces display line
 * with an italic sky-coloured emphasis word, and an optional right slot.
 */
export function PageHeader({
  eyebrow,
  title,
  emphasis,
  trailing = ".",
  subtitle,
  actions,
  className,
}: {
  eyebrow?: string;
  title: string;
  /** Rendered italic + primary, immediately after the title. */
  emphasis?: string;
  /** Punctuation closing the display line. Pass "" to omit. */
  trailing?: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("animate-rise mb-8 flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow mb-2.5">{eyebrow}</p>}
        <h1 className="font-display text-[clamp(2.1rem,4.4vw,3.1rem)] leading-[1.05] text-foreground">
          {title}
          {emphasis && (
            <>
              {" "}
              <em className="italic text-primary">{emphasis}</em>
            </>
          )}
          {trailing}
        </h1>
        {subtitle && (
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

const STAT_TONES: Record<string, string> = {
  primary: "bg-primary-soft text-primary",
  accent: "bg-accent/12 text-accent",
  warning: "bg-warning/18 text-warning",
  success: "bg-success/12 text-success",
  secondary: "bg-secondary/10 text-secondary",
};

/** KPI tile — micro label + icon chip, oversized serif numeral, muted hint. */
export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "primary",
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: LucideIcon;
  tone?: keyof typeof STAT_TONES;
  className?: string;
}) {
  return (
    <div className={cn("surface-card hover-lift p-5", className)}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-micro font-bold uppercase tracking-[0.2em] text-muted-foreground">{label}</p>
        {Icon && (
          <span
            className={cn(
              "grid h-7 w-7 shrink-0 place-items-center rounded-[9px]",
              STAT_TONES[tone] ?? STAT_TONES.primary
            )}
          >
            <Icon className="h-3.5 w-3.5" />
          </span>
        )}
      </div>
      <p className="font-display mt-3 text-[clamp(1.9rem,7vw,2.6rem)] font-normal leading-none tracking-tight">{value}</p>
      {hint && <p className="mt-2.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Navy hero panel with a radial sky glow — used for the "next thing" moment. */
export function HeroPanel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "animate-rise relative overflow-hidden rounded-[26px] gradient-hero p-8 text-secondary-foreground sm:p-10",
        className
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-24 -top-28 h-80 w-80 rounded-full"
        style={{ background: "radial-gradient(circle, hsl(var(--primary) / 0.3), transparent 70%)" }}
      />
      <div className="relative">{children}</div>
    </section>
  );
}

/** Rounded pill filter row item. */
export function FilterChip({
  active,
  children,
  ...props
}: { active?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-pressed={active}
      {...props}
      className={cn(
        "rounded-full px-4 py-2 text-2xs font-bold uppercase tracking-[0.16em] transition-all",
        active
          ? "bg-secondary text-secondary-foreground shadow-sm"
          : "border border-border bg-card text-muted-foreground hover:border-primary/45 hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}
