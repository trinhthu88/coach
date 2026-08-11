import type { Tables } from "@/integrations/supabase/types";

export type Goal = Pick<
  Tables<"coachee_goals">,
  "id" | "title" | "description" | "target_date" | "status" | "created_at"
>;

export type Milestone = Pick<
  Tables<"coachee_milestones">,
  "id" | "goal_id" | "title" | "target_date" | "is_done" | "done_at"
>;

export type GoalRating = Tables<"coachee_goal_ratings">;

export type SessionGoalRating = Tables<"session_goal_ratings">;

export type SessionRow = Tables<"sessions">;
export type PeerSessionRow = Tables<"peer_sessions">;

export interface ProgrammeInfo {
  enrollmentId: string;
  programmeName: string;
  startDate: string | null;
  endDate: string | null;
  sessionsAllowed: number;
  durationMonths: number;
}

export interface SessionUsage {
  monthly_limit: number;
  used_this_month: number;
}

export interface RawActionItem {
  text: string;
  done?: boolean;
  due_date?: string | null;
  milestone_id?: string | null;
}

export type SessionSource = "coaching" | "peer";

/**
 * A coaching or peer session normalized to a common shape so the journey
 * pages (coachee viewing their own journey, coach viewing their own
 * journey-as-coachee) can share derived-data hooks and presentational
 * components. `_otherCoachId` is whoever is coaching this person in that
 * session (coach_id for coaching sessions, peer_coach_id for peer ones).
 */
export type JourneySession =
  | (SessionRow & { _source: "coaching"; _otherCoachId: string | null })
  | (PeerSessionRow & { _source: "peer"; _otherCoachId: string | null });
