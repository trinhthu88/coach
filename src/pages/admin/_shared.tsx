import { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";

export function AdminPageHeader({
  eyebrow = "Admin",
  title,
  emphasize,
  trailing = "",
  subtitle,
  right,
}: {
  eyebrow?: string;
  title: string;
  emphasize?: string;
  trailing?: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  return (
    <PageHeader
      eyebrow={eyebrow}
      title={title}
      emphasis={emphasize}
      trailing={trailing}
      subtitle={subtitle}
      actions={right}
    />
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
    <div className="surface-card hover-lift flex items-start justify-between p-4">
      <div className="min-w-0">
        <p className="text-[9.5px] font-bold uppercase tracking-[0.2em] text-muted-foreground">{label}</p>
        <p className="font-display mt-2 text-[2rem] font-normal leading-none tracking-tight">{value}</p>
        {hint && <p className={cn("mt-2 text-[11px]", hintCls)}>{hint}</p>}
      </div>
      {Icon && (
        <div className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-[9px]", toneBg[tone])}>
          <Icon className="h-3.5 w-3.5" />
        </div>
      )}
    </div>
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
  className,
}: {
  children: ReactNode;
  tone?: "muted" | "primary" | "success" | "warning" | "destructive" | "accent" | "secondary";
  className?: string;
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
    <span className={cn("inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold", map[tone], className)}>
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

/**
 * Client-side pager for admin tables that already fetch the full dataset and
 * filter in-memory — slice `rows` to a page yourself (`rows.slice((page-1)*pageSize, page*pageSize)`)
 * and render this beneath the table to move between pages. Renders nothing
 * when everything fits on one page.
 */
export function TablePager({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}) {
  const { t } = useTranslation("admin");
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between border-t px-4 py-3">
      <p className="text-[11px] text-muted-foreground">{t("pager.pageOf", { page, total: totalPages })}</p>
      <div className="flex items-center gap-1.5">
        <Button variant="outline" size="sm" onClick={() => onChange(page - 1)} disabled={page <= 1}>
          <ChevronLeft className="h-3.5 w-3.5" /> {t("pager.previous")}
        </Button>
        <Button variant="outline" size="sm" onClick={() => onChange(page + 1)} disabled={page >= totalPages}>
          {t("pager.next")} <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
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
