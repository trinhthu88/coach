export type Status = "pending_approval" | "active" | "rejected" | "suspended" | "reach_limit";

export interface CoacheeRow {
  id: string;
  full_name: string;
  email: string;
  status: Status;
  created_at: string;
  booked: number;
  done: number;
  monthly_limit: number;
  selected_coaches: { id: string; name: string }[];
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
  sessions_completed: number;
  coachees_count: number;
  rating_avg: number;
  country_based: string | null;
  years_experience: number | null;
  // Coach-as-coachee — sourced from coach_programme_enrollments -> coach_programmes;
  // null = unlimited.
  coach_limit: number | null;
  coach_used: number;
  peer_limit: number | null;
  peer_used: number;
  coach_programme_name: string | null;
  assigned_coaches: { id: string; name: string }[];
}
