import type { ReactNode } from "react";
import { LockKeyhole } from "lucide-react";
import { cn } from "@/lib/utils";
import { clampPct } from "@/lib/programmeProfile";
import { PROFILE_COLORS } from "./profileTheme";

const { CARD, LINE, NAVY } = PROFILE_COLORS;

export function ProfileSection({
  children,
  className,
  id,
  labelledBy,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
  labelledBy?: string;
}) {
  return (
    <section
      id={id}
      aria-labelledby={labelledBy}
      className={cn("rounded-[14px] border p-[22px]", className)}
      style={{ background: CARD, borderColor: LINE }}
    >
      {children}
    </section>
  );
}

export function ProfileSectionTitle({ title, aside, id, large = false }: { title: string; aside?: ReactNode; id?: string; large?: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2.5">
      <h2 id={id} className={cn("font-serif font-normal", large ? "text-[19px]" : "text-[17px]")}>{title}</h2>
      {aside != null && (typeof aside === "string" ? <span className="text-[10.5px] text-[#9a938a]">{aside}</span> : aside)}
    </div>
  );
}

export function HeaderMeta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9px] font-bold uppercase tracking-[.16em] text-white/40">{label}</div>
      <div className="mt-1.5 text-[13px] font-medium">{value}</div>
    </div>
  );
}

export function ProfileKpi({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-[14px] border p-[18px]" style={{ background: CARD, borderColor: LINE }}>
      <div className="font-display text-[32px] font-light leading-none" style={{ color }}>{value}</div>
      <div className="mt-[11px] text-[9.5px] font-bold uppercase tracking-[.16em] text-[#6a6560]">{label}</div>
    </div>
  );
}

export function ProgressRow({ label, value, pct, color, empty = false }: { label: string; value: string; pct: number; color: string; empty?: boolean }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2.5">
        <span className="text-xs text-[#6a6560]">{label}</span>
        <span className="font-serif text-xl font-light" style={{ color }}>{value}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#eee8de]">
        <div className="h-full rounded-full" style={{ width: `${empty ? 0 : clampPct(pct)}%`, background: color }} />
      </div>
    </div>
  );
}

export function SmallMetric({ label, value, color = NAVY }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div className="font-serif text-[22px] font-light leading-none" style={{ color }}>{value}</div>
      <div className="mt-1.5 text-[9.5px] font-bold uppercase tracking-[.14em] text-[#9a938a]">{label}</div>
    </div>
  );
}

/** A section-level note: `locked` for privacy-withheld content, plain for a truthful empty state. */
export function UnavailableNote({ text, locked = true }: { text: string; locked?: boolean }) {
  return (
    <div className="mt-3 flex min-h-[56px] items-center justify-center rounded-lg border border-dashed border-[#ddd6cc] bg-[#f6f3ee] px-3 text-center text-[10.5px] leading-relaxed text-[#9a938a]">
      {locked && <LockKeyhole className="mr-2 h-3.5 w-3.5 shrink-0" />}
      {text}
    </div>
  );
}

/** A fetch failure — deliberately distinct from an empty state. */
export function ProfileLoadError({ text, onRetry, retryLabel }: { text: string; onRetry?: () => void; retryLabel?: string }) {
  return (
    <div role="alert" className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#f0d5cc] bg-[#fdf6f2] px-3 py-2.5 text-[10.5px] leading-relaxed text-[#a8341c]">
      <span>{text}</span>
      {onRetry && retryLabel && (
        <button type="button" onClick={onRetry} className="rounded-full border border-[#cfc7bb] px-3 py-1 text-[10.5px] font-semibold text-[#062f3e]">
          {retryLabel}
        </button>
      )}
    </div>
  );
}

export function ProfileSkeleton({ className }: { className?: string }) {
  return <div className={cn("mt-4 animate-pulse rounded-xl bg-[#eee8de]/70", className ?? "h-24")} />;
}

export function MiniProgress({ pct, color }: { pct: number | null; color: string }) {
  return (
    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#eee8de]">
      <div className="h-full rounded-full" style={{ width: `${pct ?? 0}%`, background: color }} />
    </div>
  );
}
