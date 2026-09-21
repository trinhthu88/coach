export type ClientStatus = "on_track" | "needs_attention" | "at_risk";

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
  overdueActions: number;
  status: ClientStatus;
  weekStart: string | null;
}
