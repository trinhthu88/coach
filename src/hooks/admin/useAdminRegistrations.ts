import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { CoachListRow, CoacheeRow, Status } from "./types";
import { fetchAdminCurrentEnrollments } from "@/lib/enrollments";
import { canonicalModuleUnits, fetchAdminCanonicalProgress } from "@/lib/adminCanonicalProgress";

type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
type CoachProfileRow = Database["public"]["Tables"]["coach_profiles"]["Row"];
type UserRoleRow = Database["public"]["Tables"]["user_roles"]["Row"];

/**
 * Loads and manages the admin registrations list (coachees + coaches). The
 * retired allowlists (coachee_coach_allowlist, coach_as_coachee_allowlist) are
 * not read: a learner's Coach is their cohort's Coach pool.
 */
export function useAdminRegistrations() {
  const [loading, setLoading] = useState(true);
  const [coachees, setCoachees] = useState<CoacheeRow[]>([]);
  const [coaches, setCoaches] = useState<CoachListRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true);

    // Fetch all roles
    const { data: roles } = await supabase
      .from("user_roles")
      .select("user_id, role");
    const rolesData = (roles || []) as Pick<UserRoleRow, "user_id" | "role">[];
    const coacheeIds = rolesData.filter((r) => r.role === "coachee").map((r) => r.user_id);
    const coachIds = rolesData.filter((r) => r.role === "coach").map((r) => r.user_id);

    const [
      { data: profiles },
      { data: cps },
      { data: programmeEnrollments },
      { data: delivery },
      currentByUser,
    ] = await Promise.all([
      supabase.from("profiles").select("id, full_name, email, status, created_at"),
      supabase.from("coach_profiles").select("*"),
       supabase.from("programme_enrollments").select("id, user_id, programme_id, status, start_date, programmes(name)").in("status", ["active", "at_risk", "paused"]),
      // What each Coach has delivered: held Coaching over the reporting
      // population (admin_coach_delivery_summary, 20261007001100).
      supabase.rpc("admin_coach_delivery_summary"),
      fetchAdminCurrentEnrollments(),
    ]);

    const profilesData = (profiles || []) as Pick<
      ProfileRow,
      "id" | "full_name" | "email" | "status" | "created_at"
    >[];
    const cpsData = (cps || []) as CoachProfileRow[];

    const profilesById = new Map(profilesData.map((p) => [p.id, p]));
    const cpById = new Map(cpsData.map((c) => [c.id, c]));
    const deliveryByCoach = new Map((delivery ?? []).map((d) => [d.coach_id, d]));

    // Each person's enrollment and its canonical module rows -- the
    // learner's Coaching units and the Coach-as-learner's own -- never a
    // local count of session rows.
    // Each person's enrollment as the server resolves it
    // (admin_current_enrollments): the current one -- the learner's own
    // answer, enrollment_is_ongoing -- else their latest record, shown with
    // its own status (a paused learner stays findable). Never chosen here.
    const enrollmentByUser = new Map<string, NonNullable<typeof programmeEnrollments>[number]>();
    for (const userId of [...new Set([...coacheeIds, ...coachIds])]) {
      const resolved = currentByUser.get(userId);
      const enrollmentId = resolved?.currentEnrollmentId ?? resolved?.latestEnrollmentId ?? null;
      const enrollment = (programmeEnrollments || []).find((e) => e.id === enrollmentId);
      if (enrollment) enrollmentByUser.set(userId, enrollment);
    }
    const canonical = await fetchAdminCanonicalProgress([...enrollmentByUser.values()].map((e) => e.id)).catch(() => []);
    const canonicalByEnrollment = new Map(canonical.map((c) => [c.enrollment_id, c]));
    const canonicalFor = (userId: string) => {
      const enr = enrollmentByUser.get(userId);
      return enr ? canonicalByEnrollment.get(enr.id) : undefined;
    };

    const coacheeRows: CoacheeRow[] = coacheeIds
      .map((id): CoacheeRow | null => {
        const p = profilesById.get(id);
        if (!p) return null;
        const row = canonicalFor(id);
        return {
          id,
          full_name: p.full_name,
          email: p.email,
          status: p.status as Status,
          created_at: p.created_at,
          coaching_units: canonicalModuleUnits(row, "coaching"),
          coaching_booked_units: row?.progress_available ? row.coaching_booked_units : null,
        };
      })
      .filter((row): row is CoacheeRow => row !== null);

    const coachRows: CoachListRow[] = coachIds
      .map((id): CoachListRow | null => {
        const p = profilesById.get(id);
        const cp = cpById.get(id);
        if (!p) return null;
        const enr = enrollmentByUser.get(id);
        const canonicalRow = canonicalFor(id);
        return {
          id,
          full_name: p.full_name,
          email: p.email,
          title: null,
          status: p.status as Status,
          created_at: p.created_at,
          approval_status: cp?.approval_status || "pending_approval",
          delivered_sessions: deliveryByCoach.get(id)?.delivered_sessions ?? 0,
          coachees_count: deliveryByCoach.get(id)?.learners_served ?? 0,
          rating_avg: cp?.rating_avg == null ? null : Number(cp.rating_avg),
          country_based: cp?.country_based || null,
          years_experience: cp?.years_experience || null,
          coaching_units: canonicalModuleUnits(canonicalRow, "coaching"),
          peer_units: canonicalModuleUnits(canonicalRow, "peer"),
          coach_programme_name: (enr as { programmes?: { name?: string } | null } | undefined)?.programmes?.name ?? null,
        };
      })
      .filter((row): row is CoachListRow => row !== null);

    setCoachees(coacheeRows.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at)));
    setCoaches(coachRows.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at)));
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return {
    loading,
    coachees,
    coaches,
    reload: load,
  };
}
