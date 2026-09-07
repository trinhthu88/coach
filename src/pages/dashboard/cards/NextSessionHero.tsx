import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowUpRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

function countdown(startTime: string): { key: "soon" | "today" | "inOneDay" | "inDays"; count?: number } {
  const now = new Date();
  const start = new Date(startTime);
  const diffHours = (start.getTime() - now.getTime()) / 3_600_000;
  if (diffHours <= 2) return { key: "soon" };
  const dayDiff = Math.round(
    (Date.UTC(start.getFullYear(), start.getMonth(), start.getDate()) -
      Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) /
      86_400_000
  );
  if (dayDiff <= 0) return { key: "today" };
  if (dayDiff === 1) return { key: "inOneDay" };
  return { key: "inDays", count: dayDiff };
}

/**
 * Full-width dark-gradient "next session" hero — the design's most
 * distinctive element, reused by CoachingReceiveCard and CoachingGiveCard.
 * Renders an elegant empty state (same dark card, no countdown/CTA) when
 * there's no upcoming session, so the card never collapses to nothing.
 */
export function NextSessionHero({
  icon: Icon,
  eyebrowLabel,
  badge,
  nextSession,
  ctaLabel,
  ctaHref,
  emptyTitle,
  emptyBody,
  emptyCtaLabel,
  emptyCtaHref,
  children,
}: {
  icon: LucideIcon;
  eyebrowLabel: string;
  badge?: React.ReactNode;
  nextSession: { topic: string; startTime: string; counterpartName: string } | null;
  ctaLabel: string;
  ctaHref: string;
  emptyTitle: string;
  emptyBody: string;
  emptyCtaLabel?: string;
  emptyCtaHref?: string;
  children?: React.ReactNode;
}) {
  const { t } = useTranslation("dashboard");

  return (
    <section className="relative overflow-hidden rounded-[24px] bg-[linear-gradient(135deg,#062f3e_0%,#0a4256_55%,#04202b_100%)] p-6 text-white shadow-[0_24px_56px_-32px_rgba(6,47,62,0.7)] sm:p-7">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-[radial-gradient(circle,hsl(var(--primary)/.26),transparent_70%)]"
      />
      <div className="relative flex flex-wrap items-start justify-between gap-3">
        <p className="inline-flex items-center gap-1.5 text-[9.5px] font-bold uppercase tracking-[.22em] text-primary-glow">
          <Icon className="h-3.5 w-3.5" /> {eyebrowLabel}
        </p>
        {badge}
      </div>

      {nextSession ? (
        <div className="relative flex flex-wrap items-end justify-between gap-6">
          <div className="min-w-[240px] flex-1">
            <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/[.14] px-3 py-1.5 text-[9.5px] font-bold uppercase tracking-[.22em] text-primary-glow">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
              </span>
              {(() => {
                const c = countdown(nextSession.startTime);
                return t(`nextSessionCountdown.${c.key}`, { count: c.count });
              })()}
            </div>
            <h3 className="font-display mt-4 max-w-[24ch] text-[1.6rem] font-light leading-[1.12] tracking-[-0.025em] sm:text-[1.85rem]">
              {nextSession.topic}
            </h3>
            <p className="mt-3 text-[12.5px] text-white/66">
              {nextSession.counterpartName} · {new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(nextSession.startTime))}
            </p>
          </div>
          <Link
            to={ctaHref}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-[13px] bg-primary px-5 py-3 text-[12.5px] font-semibold text-secondary shadow-[0_12px_28px_-12px_rgba(61,180,208,.9)] transition-transform hover:-translate-y-0.5"
          >
            {ctaLabel} <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      ) : (
        <div className="relative mt-4">
          <h3 className="font-display max-w-[26ch] text-xl font-light leading-snug">{emptyTitle}</h3>
          <p className="mt-2 max-w-[46ch] text-[12.5px] text-white/60">{emptyBody}</p>
          {emptyCtaHref && emptyCtaLabel && (
            <Link
              to={emptyCtaHref}
              className="mt-4 inline-flex items-center gap-1.5 rounded-[13px] bg-primary px-5 py-2.5 text-[12.5px] font-semibold text-secondary shadow-[0_12px_28px_-12px_rgba(61,180,208,.9)] transition-transform hover:-translate-y-0.5"
            >
              {emptyCtaLabel} <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
      )}

      {children && <div className="relative mt-5 border-t border-white/10 pt-4">{children}</div>}
    </section>
  );
}

/** Matches NextSessionHero's footprint so the dashboard doesn't jump once
 * the card's data resolves. */
export function HeroSkeleton() {
  return (
    <div className="h-[168px] animate-pulse rounded-[24px] bg-[linear-gradient(135deg,#062f3e_0%,#0a4256_55%,#04202b_100%)] opacity-60" />
  );
}

export function HeroMetricRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1 text-[12.5px]">
      <span className="text-white/60">{label}</span>
      <span className="font-semibold text-white">{value}</span>
    </div>
  );
}

export function HeroFooterLink({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) {
  return (
    <Link
      to={to}
      className={cn("inline-flex items-center gap-1 text-[12.5px] font-semibold text-primary-glow hover:underline", className)}
    >
      {children}
    </Link>
  );
}
