import type { SponsorRosterRow } from "@/hooks/sponsor/useSponsorDashboardData";

export type SponsorEnrollmentStatus = SponsorRosterRow["enrollment_status"];

export const STATUS_TONE: Record<SponsorEnrollmentStatus, "success" | "warning" | "destructive" | "muted"> = {
  active: "success",
  completed: "muted",
  paused: "warning",
  at_risk: "destructive",
};
export const STATUS_LABEL_KEY: Record<SponsorEnrollmentStatus, string> = {
  active: "active",
  completed: "completed",
  paused: "paused",
  at_risk: "atRisk",
};

/** Prefer the explicit local-contract status, while remaining compatible with the hosted legacy RPC. */
export function effectiveSponsorStatus(row: Pick<SponsorRosterRow, "enrollment_status" | "effective_enrollment_status">): SponsorEnrollmentStatus {
  return row.effective_enrollment_status ?? row.enrollment_status;
}

export function storedSponsorStatus(row: Pick<SponsorRosterRow, "enrollment_status" | "stored_enrollment_status">): SponsorEnrollmentStatus {
  return row.stored_enrollment_status ?? row.enrollment_status;
}

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

/** Lifecycle is date-derived; pace can still be mixed inside a completed cohort. */
export function cohortLifecycleStatus(start: string | null, end: string | null): "upcoming" | "active" | "complete" {
  const startMs = start ? new Date(start).getTime() : NaN;
  const endMs = end ? new Date(end).getTime() : NaN;
  if (Number.isFinite(startMs) && Date.now() < startMs) return "upcoming";
  if (Number.isFinite(endMs) && Date.now() > endMs) return "complete";
  return "active";
}
