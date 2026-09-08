import type { SponsorRosterRow } from "@/hooks/sponsor/useSponsorDashboardData";

export const STATUS_TONE: Record<SponsorRosterRow["enrollment_status"], "success" | "warning" | "destructive" | "muted"> = {
  active: "success",
  completed: "muted",
  paused: "warning",
  at_risk: "destructive",
};
export const STATUS_LABEL_KEY: Record<SponsorRosterRow["enrollment_status"], string> = {
  active: "active",
  completed: "completed",
  paused: "paused",
  at_risk: "atRisk",
};

export function initials(name: string) {
  return name.split(" ").map((p) => p[0]).join("").toUpperCase().slice(0, 2);
}

export type HealthSignal = "healthy" | "watch" | "attention";

/** Needs attention above 30% at-risk, Watch above 15%, else Healthy. */
export function healthSignal(atRiskCount: number, total: number): HealthSignal {
  if (total === 0) return "healthy";
  const ratio = atRiskCount / total;
  if (ratio > 0.3) return "attention";
  if (ratio > 0.15) return "watch";
  return "healthy";
}

/** Elapsed/total days for a cohort with known start/end dates, clamped to the programme window. */
export function cohortProgress(start: string | null, end: string | null): { elapsed: number; total: number; pct: number } | null {
  if (!start || !end) return null;
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  const total = Math.max(1, Math.round((endMs - startMs) / 86400000));
  const elapsed = Math.max(0, Math.min(total, Math.round((Date.now() - startMs) / 86400000)));
  return { elapsed, total, pct: (elapsed / total) * 100 };
}
