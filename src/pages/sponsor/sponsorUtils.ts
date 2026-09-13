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

/** Maps the canonical Sponsor aggregate health dimension to the existing UI tone. */
export function healthStatusSignal(status: string | null | undefined): HealthSignal {
  if (status === "at_risk") return "attention";
  if (status === "not_assessed") return "watch";
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

export type ProgrammeModuleType =
  | "coaching" | "peer_coaching" | "mentoring" | "triads"
  | "training" | "quiz" | "assessment" | "daily_prompt";

/**
 * Leader Detail header status label (spec: "Do NOT use at_risk as an
 * enrollment status" there). at_risk is a real enrollment_status value in
 * this schema -- an ongoing enrollment, just flagged -- so it collapses into
 * "Active" for this one display rather than inventing a fifth status or
 * changing the stored value. On Track / Not On Track already carries the
 * "flagged" signal separately. This mapping is intentionally local to the
 * Leader Detail header; the Cohort roster's status pill is unchanged.
 */
export function leaderHeaderStatusKey(status: SponsorRosterRow["enrollment_status"]): "active" | "paused" | "completed" {
  if (status === "paused") return "paused";
  if (status === "completed") return "completed";
  return "active";
}

/** Sponsor-facing label for a configured programme cadence activity type. */
export function moduleLabel(module: string): string {
  const labels: Record<string, string> = {
    coaching: "1:1 Coaching",
    peer_coaching: "Peer Coaching",
    mentoring: "Mentor Coaching",
    triads: "Triad Practice",
    training: "Module",
    quiz: "Quiz",
    assessment: "Assessment",
    daily_prompt: "Daily Prompt",
  };
  return labels[module] ?? module;
}
