import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface AdminDashboardStats {
  totalCoachees: number;
  bookedSessions: number;
  completedSessions: number;
  cancelledSessions: number;
  totalSessions: number;
  pendingLinkSessions: number;
  /** Existing accounts sitting in coach_profiles/coachee_profiles with approval_status = pending_approval (e.g. from bulk import). */
  pendingCoaches: number;
  pendingCoachees: number;
  /** New access_requests rows (status = pending) — no account exists yet, awaiting the admin's first look. */
  newCoachApplications: number;
  newCoacheeApplications: number;
}

const initialStats: AdminDashboardStats = {
  totalCoachees: 0,
  bookedSessions: 0,
  completedSessions: 0,
  cancelledSessions: 0,
  totalSessions: 0,
  pendingLinkSessions: 0,
  pendingCoaches: 0,
  pendingCoachees: 0,
  newCoachApplications: 0,
  newCoacheeApplications: 0,
};

async function fetchAdminDashboardStats(): Promise<AdminDashboardStats> {
  const [
    coacheeRolesRes,
    sessionsRes,
    pendingLinkRes,
    pendingCoachesRes,
    pendingCoacheesRes,
    newCoachApplicationsRes,
    newCoacheeApplicationsRes,
  ] = await Promise.all([
    supabase
      .from("user_roles")
      .select("user_id", { count: "exact", head: true })
      .eq("role", "coachee"),
    supabase.from("sessions").select("id, status, meeting_url"),
    supabase
      .from("sessions")
      .select("id", { count: "exact", head: true })
      .in("status", ["confirmed", "pending_coach_approval"])
      .or("meeting_url.is.null,meeting_url.eq."),
    supabase
      .from("coach_profiles")
      .select("id", { count: "exact", head: true })
      .eq("approval_status", "pending_approval"),
    supabase
      .from("coachee_profiles")
      .select("id", { count: "exact", head: true })
      .eq("approval_status", "pending_approval"),
    supabase
      .from("access_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending")
      .eq("role", "coach"),
    supabase
      .from("access_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending")
      .eq("role", "executive"),
  ]);

  const all = sessionsRes.data || [];
  const booked = all.filter((s) =>
    ["pending_coach_approval", "confirmed", "completed"].includes(s.status)
  ).length;
  const completed = all.filter((s) => s.status === "completed").length;
  const cancelled = all.filter((s) => s.status === "cancelled").length;

  return {
    totalCoachees: coacheeRolesRes.count || 0,
    bookedSessions: booked,
    completedSessions: completed,
    cancelledSessions: cancelled,
    totalSessions: all.length,
    pendingLinkSessions: pendingLinkRes.count || 0,
    pendingCoaches: pendingCoachesRes.count || 0,
    pendingCoachees: pendingCoacheesRes.count || 0,
    newCoachApplications: newCoachApplicationsRes.count || 0,
    newCoacheeApplications: newCoacheeApplicationsRes.count || 0,
  };
}

export function useAdminDashboardStats() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-dashboard-stats"],
    queryFn: fetchAdminDashboardStats,
    staleTime: 30_000,
  });

  return { stats: data ?? initialStats, loading: isLoading };
}
