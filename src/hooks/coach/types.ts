export type ClientStatus = "on_track" | "needs_attention" | "at_risk";

export interface RawAction {
  text: string;
  done?: boolean;
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
  actionItemsDone: number;
  actionItemsTotal: number;
  overdueActions: number;
  status: ClientStatus;
  weekStart: string | null;
}
