import type { CanonicalModuleUnits } from "@/lib/adminCanonicalProgress";

export type Status = "pending_approval" | "active" | "rejected" | "suspended" | "reach_limit";

export interface CoacheeRow {
  id: string;
  full_name: string;
  email: string;
  status: Status;
  created_at: string;
  /** Coaching units of the learner's current enrollment (canonical); null without one. */
  coaching_units: CanonicalModuleUnits | null;
  /** Coaching units booked (live sessions holding a requirement), canonical; null without one. */
  coaching_booked_units: number | null;
}

export interface CoachOpt {
  id: string;
  name: string;
}

export interface CoachListRow {
  id: string;
  full_name: string;
  email: string;
  title: string | null;
  status: Status;
  created_at: string;
  approval_status: string;
  /** Held Coaching sessions this Coach delivered (admin_coach_delivery_summary). */
  sessions_completed: number;
  coachees_count: number;
  rating_avg: number | null;
  country_based: string | null;
  years_experience: number | null;
  // Coach as learner: the canonical module rows of their own enrollment
  // (admin_canonical_enrollment_progress). Null when not enrolled.
  coaching_units: CanonicalModuleUnits | null;
  peer_units: CanonicalModuleUnits | null;
  coach_programme_name: string | null;
}
