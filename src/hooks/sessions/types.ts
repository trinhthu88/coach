import type { Database } from "@/integrations/supabase/types";
import type { EnrollmentActionItem } from "@/lib/enrollmentActions";

export type SessionStatus =
  | "pending_coach_approval"
  | "confirmed"
  | "completed"
  | "cancelled"
  | "rescheduled";

export interface ProfileLite {
  id: string;
  full_name: string;
  email: string;
  avatar_url: string | null;
}

export interface SessionRow {
  id: string;
  enrollment_id: string | null;
  coach_id: string;
  coachee_id: string;
  topic: string;
  start_time: string;
  duration_minutes: number;
  status: SessionStatus;
  meeting_url: string | null;
  coach_notes: string | null;
  coachee_notes: string | null;
  enrollment_actions: EnrollmentActionItem[];
  cancelled_at: string | null;
  slot_id: string | null;
}

export interface ActionItem {
  id?: string;
  text: string;
  done?: boolean;
  description?: string | null;
  due_date?: string | null;
  milestone_id?: string | null;
}

export interface MilestoneLite {
  id: string;
  title: string;
  goal_id: string;
  goal_title?: string;
}

export type Attachment =
  Database["public"]["Tables"]["session_attachments"]["Row"];

/** ICF competency ratings; null = not rated (never a default value). */
export type PeerFeedbackState = {
  ethical_practice: number | null;
  coaching_mindset: number | null;
  maintains_agreements: number | null;
  trust_safety: number | null;
  maintains_presence: number | null;
  listens_actively: number | null;
  evokes_awareness: number | null;
  facilitates_growth: number | null;
  feedback_note: string;
  existed: boolean;
};

export const PEER_COMPETENCY_KEYS = [
  "ethical_practice",
  "coaching_mindset",
  "maintains_agreements",
  "trust_safety",
  "maintains_presence",
  "listens_actively",
  "evokes_awareness",
  "facilitates_growth",
] as const;

/** A peer feedback save needs at least one competency the rater actually set. */
export function hasAnyCompetencyRating(state: PeerFeedbackState): boolean {
  return PEER_COMPETENCY_KEYS.some((k) => state[k] != null);
}

export function normalizeItems(raw: EnrollmentActionItem[]): ActionItem[] {
  return raw.map((it) => ({
    id: it.id,
    text: it.text || "",
    done: !!it.done,
    description: it.description || null,
    due_date: it.due_date || null,
    milestone_id: it.milestone_id || null,
  }));
}
