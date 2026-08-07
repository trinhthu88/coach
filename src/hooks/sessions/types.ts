import type { Database } from "@/integrations/supabase/types";

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
  coach_id: string;
  coachee_id: string;
  topic: string;
  start_time: string;
  duration_minutes: number;
  status: SessionStatus;
  meeting_url: string | null;
  coach_notes: string | null;
  coachee_notes: string | null;
  action_items: Database["public"]["Tables"]["sessions"]["Row"]["action_items"];
  cancelled_at: string | null;
  slot_id: string | null;
}

export interface ActionItem {
  text: string;
  done?: boolean;
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

export function normalizeItems(raw: unknown): ActionItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((it) =>
    typeof it === "string"
      ? { text: it, done: false, due_date: null, milestone_id: null }
      : {
          text: (it as ActionItem).text || "",
          done: !!(it as ActionItem).done,
          due_date: (it as ActionItem).due_date || null,
          milestone_id: (it as ActionItem).milestone_id || null,
        }
  );
}
