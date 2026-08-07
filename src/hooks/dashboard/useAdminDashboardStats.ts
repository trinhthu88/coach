import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface AdminDashboardStats {
  totalCoachees: number;
  bookedSessions: number;
  completedSessions: number;
  cancelledSessions: number;
  totalSessions: number;
  pendingLinkSessions: number;
  pendingCoaches: number;
  pendingCoachees: number;
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
};

export function useAdminDashboardStats() {
  const [stats, setStats] = useState<AdminDashboardStats>(initialStats);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [coacheeRolesRes, sessionsRes, pendingLinkRes, pendingCoachesRes, pendingCoacheesRes] = await Promise.all([
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
      ]);

      const all = sessionsRes.data || [];
      const booked = all.filter((s) =>
        ["pending_coach_approval", "confirmed", "completed"].includes(s.status)
      ).length;
      const completed = all.filter((s) => s.status === "completed").length;
      const cancelled = all.filter((s) => s.status === "cancelled").length;

      setStats({
        totalCoachees: coacheeRolesRes.count || 0,
        bookedSessions: booked,
        completedSessions: completed,
        cancelledSessions: cancelled,
        totalSessions: all.length,
        pendingLinkSessions: pendingLinkRes.count || 0,
        pendingCoaches: pendingCoachesRes.count || 0,
        pendingCoachees: pendingCoacheesRes.count || 0,
      });
      setLoading(false);
    })();
  }, []);

  return { stats, loading };
}
