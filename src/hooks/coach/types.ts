/**
 * Canonical pace status (canonical_enrollment_progress.pace_status) -- the
 * same status the Learner, Admin and Sponsor see. Never derived client-side.
 */
export type ClientPaceStatus = "on_track" | "ahead" | "behind" | "at_risk" | "completed";

export interface RawAction {
  id?: string;
  text: string;
  done?: boolean;
  description?: string | null;
  due_date?: string | null;
  milestone_id?: string | null;
}

export interface Client {
  id: string;
  full_name: string;
  email: string;
  avatar_url: string | null;
  totalSessions: number;
  completed: number;
  cancelled: number;
  upcomingCount: number;
  lastSession: string | null;
  nextSession: string | null;
  goalsActive: number;
  goalsAll: { id: string; title: string }[];
  milestonesDone: number;
  milestonesTotal: number;
  /** The enrollment of this coach's latest confirmed/completed session with the client. */
  enrollmentId: string | null;
  /** canonicalCompletionPct of that enrollment — the number the learner, Admin and Sponsor see. */
  completionPct: number | null;
  actionItemsDone: number;
  actionItemsTotal: number;
  /** Operational context only (overdue follow-up actions); never redefines status. */
  overdueActions: number;
  /** Canonical pace status of that enrollment; null when none or not loaded. */
  paceStatus: ClientPaceStatus | null;
  /** The canonical progress read failed: show an error state, never a silent zero. */
  progressError: boolean;
  weekStart: string | null;
}
