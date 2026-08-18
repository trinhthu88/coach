import type { Database } from "@/integrations/supabase/types";

export type MentoringSessionRow = Database["public"]["Tables"]["mentoring_sessions"]["Row"];
export type MentoringFeedbackRow = Database["public"]["Tables"]["mentoring_feedback"]["Row"];

export interface ProfileLite {
  id: string;
  full_name: string;
  email: string;
  avatar_url: string | null;
}

export const COMPETENCY_KEYS = [
  "ethical_practice",
  "coaching_mindset",
  "maintains_agreements",
  "trust_safety",
  "maintains_presence",
  "listens_actively",
  "evokes_awareness",
  "facilitates_growth",
] as const;

export type CompetencyKey = (typeof COMPETENCY_KEYS)[number];

export type MentoringFeedbackState = Record<CompetencyKey, string> & {
  overall_notes: string;
  existed: boolean;
};
