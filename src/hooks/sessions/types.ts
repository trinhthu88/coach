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

export type PeerFeedbackState = {
  ethical_practice: number;
  coaching_mindset: number;
  maintains_agreements: number;
  trust_safety: number;
  maintains_presence: number;
  listens_actively: number;
  evokes_awareness: number;
  facilitates_growth: number;
  feedback_note: string;
  existed: boolean;
};

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
