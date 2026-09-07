import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Loader2 } from "lucide-react";

/** Shared shell every module dashboard card renders inside — keeps spacing,
 * header layout, and the loading state identical across all eight cards. */
export function DashboardCardShell({
  icon: Icon,
  title,
  badge,
  loading,
  children,
  dataOnboarding,
  className,
}: {
  icon: React.ElementType;
  title: string;
  badge?: React.ReactNode;
  loading?: boolean;
  children: React.ReactNode;
  dataOnboarding?: string;
  className?: string;
}) {
  return (
    <Card className={cn("flex h-full flex-col p-5", className)} data-onboarding={dataOnboarding}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
          <Icon className="h-3.5 w-3.5 text-primary" /> {title}
        </p>
        {badge}
      </div>
      {loading ? (
        <div className="flex flex-1 items-center justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      ) : (
        <div className="flex flex-1 flex-col">{children}</div>
      )}
    </Card>
  );
}

export function CardMetricRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}

export function CardFooterLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
    >
      {children}
    </Link>
  );
}

export function CardEmptyHint({ text }: { text: string }) {
  return <p className="flex-1 py-4 text-sm text-muted-foreground">{text}</p>;
}

export function RoleIndicator({
  tone,
  label,
  desc,
}: {
  tone: "primary" | "success" | "accent" | "warning";
  label: string;
  desc: string;
}) {
  const map = {
    primary: "border-primary/20 bg-primary-soft text-primary",
    success: "border-success/20 bg-success/10 text-success",
    accent: "border-accent/30 bg-accent/10 text-accent",
    warning: "border-warning/30 bg-warning/10 text-warning",
  } as const;
  return (
    <div className={cn("flex items-center gap-3 rounded-xl border p-3", map[tone])}>
      <div className="flex-1">
        <p className="text-sm font-semibold">{label}</p>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
    </div>
  );
}

export function KindPill({ label, tone }: { label: string; tone: "primary" | "success" | "accent" | "warning" }) {
  const map = {
    primary: "bg-primary/10 text-primary",
    success: "bg-success/10 text-success",
    accent: "bg-accent/15 text-accent",
    warning: "bg-warning/15 text-warning",
  } as const;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest",
        map[tone]
      )}
    >
      {label}
    </span>
  );
}
