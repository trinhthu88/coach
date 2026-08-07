import { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Shared Clariva prototype primitives.
 * Every value here comes from the semantic tokens in index.css.
 */

const RING_TONES = {
  primary: "hsl(var(--primary))",
  accent: "hsl(var(--accent))",
  success: "hsl(var(--success))",
  warning: "hsl(var(--warning))",
} as const;

/** Donut progress ring with an oversized serif percentage in the middle. */
export function ProgressRing({
  value,
  label,
  note,
  tone = "primary",
  size = 118,
  stroke = 9,
  className,
  invert,
}: {
  /** 0–100 */
  value: number;
  label?: ReactNode;
  note?: ReactNode;
  tone?: keyof typeof RING_TONES;
  size?: number;
  stroke?: number;
  className?: string;
  /** Use on dark surfaces (navy hero panels). */
  invert?: boolean;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;

  return (
    <div className={cn("flex flex-col items-center text-center", className)}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth={stroke}
            stroke={invert ? "hsl(var(--primary-foreground) / 0.16)" : "hsl(var(--border))"}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            stroke={RING_TONES[tone]}
            strokeDasharray={circ}
            strokeDashoffset={circ - (circ * pct) / 100}
            style={{ transition: "stroke-dashoffset .8s cubic-bezier(.4,0,.2,1)" }}
          />
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <span
            className={cn(
              "font-display leading-none",
              invert ? "text-secondary-foreground" : "text-foreground"
            )}
            style={{ fontSize: size * 0.26 }}
          >
            {pct}%
          </span>
        </div>
      </div>
      {label && (
        <p
          className={cn(
            "mt-3 text-sm font-semibold",
            invert ? "text-secondary-foreground" : "text-foreground"
          )}
        >
          {label}
        </p>
      )}
      {note && (
        <p
          className={cn(
            "mt-1 text-xs",
            invert ? "text-secondary-foreground/70" : "text-muted-foreground"
          )}
        >
          {note}
        </p>
      )}
    </div>
  );
}

/** Session list row: left date block, title + meta, status pill, chevron. */
export function SessionRow({
  month,
  day,
  title,
  meta,
  status,
  onClick,
  className,
}: {
  month: string;
  day: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  status?: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "surface-card hover-lift group flex w-full items-center gap-5 p-5 text-left",
        className
      )}
    >
      <div className="w-[62px] shrink-0 border-r border-border pr-4 text-center">
        <p className="text-[9.5px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
          {month}
        </p>
        <p className="font-display text-[1.9rem] leading-none">{day}</p>
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-semibold text-foreground">{title}</p>
        {meta && <p className="mt-1 truncate text-xs text-muted-foreground">{meta}</p>}
      </div>
      {status}
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </button>
  );
}

/** Vertical milestone timeline with checked / pending nodes. */
export function TimelineList({
  items,
  className,
}: {
  items: Array<{
    id: string;
    date?: ReactNode;
    title: ReactNode;
    note?: ReactNode;
    done?: boolean;
  }>;
  className?: string;
}) {
  return (
    <ol className={cn("relative space-y-6 pl-8", className)}>
      <span aria-hidden className="absolute bottom-2 left-[11px] top-2 w-px bg-border" />
      {items.map((item) => (
        <li key={item.id} className="relative">
          <span
            className={cn(
              "absolute -left-8 top-0.5 grid h-[22px] w-[22px] place-items-center rounded-full border-2 text-[11px] font-bold",
              item.done
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground"
            )}
          >
            {item.done ? "✓" : ""}
          </span>
          {item.date && (
            <p className="text-[9.5px] font-bold uppercase tracking-[0.2em] text-primary">
              {item.date}
            </p>
          )}
          <p
            className={cn(
              "mt-1 text-[15px] font-semibold",
              item.done ? "text-foreground" : "text-muted-foreground"
            )}
          >
            {item.title}
          </p>
          {item.note && <p className="mt-1 text-xs text-muted-foreground">{item.note}</p>}
        </li>
      ))}
    </ol>
  );
}

const DOT_TONES = {
  critical: "bg-accent",
  warning: "bg-warning",
  info: "bg-primary",
} as const;

/** Navy "needs attention" panel with severity dots. */
export function AttentionPanel({
  title = "Needs attention",
  items,
  empty = "Nothing needs your attention.",
  className,
}: {
  title?: string;
  items: Array<{
    id: string;
    title: ReactNode;
    note?: ReactNode;
    severity?: keyof typeof DOT_TONES;
    onClick?: () => void;
  }>;
  empty?: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "animate-rise relative overflow-hidden rounded-[26px] gradient-hero p-6 text-secondary-foreground",
        className
      )}
    >
      <p className="eyebrow mb-4 text-primary-glow">{title}</p>
      {items.length === 0 ? (
        <p className="text-sm text-secondary-foreground/70">{empty}</p>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={item.onClick}
                disabled={!item.onClick}
                className="flex w-full items-start gap-3 rounded-[16px] bg-primary-foreground/[0.06] p-4 text-left transition-colors enabled:hover:bg-primary-foreground/[0.11]"
              >
                <span
                  className={cn(
                    "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                    DOT_TONES[item.severity ?? "info"]
                  )}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{item.title}</span>
                  {item.note && (
                    <span className="mt-0.5 block text-xs text-secondary-foreground/70">
                      {item.note}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Lightweight sky bar chart used for "sessions delivered by month". */
export function MiniBarChart({
  data,
  height = 180,
  className,
}: {
  data: Array<{ label: string; value: number }>;
  height?: number;
  className?: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className={cn("flex items-end gap-3", className)} style={{ height }}>
      {data.map((d) => (
        <div key={d.label} className="flex flex-1 flex-col items-center justify-end gap-2">
          <span className="text-[11px] font-semibold text-foreground">{d.value || ""}</span>
          <div
            className="w-full rounded-t-[10px] bg-gradient-to-b from-primary-glow to-primary"
            style={{ height: `${Math.max(d.value ? 6 : 2, (d.value / max) * (height - 46))}px` }}
          />
          <span className="text-[9.5px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
            {d.label}
          </span>
        </div>
      ))}
    </div>
  );
}
