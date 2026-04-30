import { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { LucideIcon } from "lucide-react";

export function AdminPageHeader({
  eyebrow = "Admin",
  title,
  emphasize,
  subtitle,
  right,
}: {
  eyebrow?: string;
  title: string;
  emphasize?: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-primary">{eyebrow}</p>
        <h1 className="font-display text-3xl tracking-tight text-secondary">
          {title} {emphasize && <em className="not-italic text-primary">{emphasize}</em>}
        </h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

export function Kpi({
  label,
  value,
  hint,
  hintTone,
  icon: Icon,
  tone = "primary",
}: {
  label: string;
  value: string | number;
  hint?: string;
  hintTone?: "up" | "down" | "muted";
  icon?: LucideIcon;
  tone?: "primary" | "secondary" | "accent" | "warning" | "success" | "destructive";
}) {
  const toneBg: Record<string, string> = {
    primary: "bg-primary-soft text-primary",
    secondary: "bg-secondary/10 text-secondary",
    accent: "bg-accent/10 text-accent",
    warning: "bg-warning/15 text-warning",
    success: "bg-success/10 text-success",
    destructive: "bg-destructive/10 text-destructive",
  };
  const hintCls =
    hintTone === "up"
      ? "text-success"
      : hintTone === "down"
      ? "text-destructive"
      : "text-muted-foreground";
  return (
    <Card className="flex items-start justify-between p-4">
      <div className="min-w-0">
        <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
        <p className="mt-1.5 text-2xl font-semibold leading-none">{value}</p>
        {hint && <p className={cn("mt-1.5 text-[11px]", hintCls)}>{hint}</p>}
      </div>
      {Icon && (
        <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", toneBg[tone])}>
          <Icon className="h-4 w-4" />
        </div>
      )}
    </Card>
  );
}

export function SectionCard({
  label,
  action,
  children,
  className,
}: {
  label: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("p-4", className)}>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
        {action}
      </div>
      {children}
    </Card>
  );
}

export function Pill({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "primary" | "success" | "warning" | "destructive" | "accent" | "secondary";
}) {
  const map: Record<string, string> = {
    muted: "bg-muted text-muted-foreground",
    primary: "bg-primary-soft text-primary",
    success: "bg-success/15 text-success",
    warning: "bg-warning/20 text-warning",
    destructive: "bg-destructive/15 text-destructive",
    accent: "bg-accent/15 text-accent",
    secondary: "bg-secondary text-secondary-foreground",
  };
  return (
    <span className={cn("inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold", map[tone])}>
      {children}
    </span>
  );
}

export function MiniBar({ pct, tone = "primary" }: { pct: number; tone?: "primary" | "success" | "warning" | "destructive" | "secondary" }) {
  const fill: Record<string, string> = {
    primary: "bg-primary",
    success: "bg-success",
    warning: "bg-warning",
    destructive: "bg-destructive",
    secondary: "bg-secondary",
  };
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", fill[tone])} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
      </div>
      <span className="w-8 text-right text-[10px] font-medium text-muted-foreground">{Math.round(pct)}%</span>
    </div>
  );
}

export function Avatar({ name, tone = "primary", size = 26 }: { name: string; tone?: string; size?: number }) {
  const map: Record<string, string> = {
    primary: "bg-primary-soft text-primary",
    secondary: "bg-secondary/10 text-secondary",
    accent: "bg-accent/15 text-accent",
    warning: "bg-warning/20 text-warning",
    success: "bg-success/15 text-success",
  };
  const initials = name
    .split(" ")
    .map((n) => n[0])
    .filter(Boolean)
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-semibold", map[tone] || map.primary)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
    >
      {initials || "?"}
    </span>
  );
}
