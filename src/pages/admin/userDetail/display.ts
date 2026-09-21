import type { Database } from "@/integrations/supabase/types";

type EnrollmentStatus = Database["public"]["Enums"]["enrollment_status"];
type Tone = "muted" | "primary" | "success" | "warning" | "destructive";

/** Pill tone per canonical (effective) enrollment status. Display only. */
export const ENROLLMENT_STATUS_TONE: Record<EnrollmentStatus, Tone> = {
  active: "primary",
  at_risk: "destructive",
  paused: "warning",
  completed: "success",
};

/** Canonical module order used across Learner, Sponsor and Admin. */
export const MODULE_ORDER = ["coaching", "training", "peer_coaching", "mentoring", "triads"] as const;
