import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { CoachListRow, CoachOpt, CoacheeRow, Status } from "./types";
import { resolveCurrentEnrollment } from "@/lib/enrollmentResolver";
import { canonicalModuleUnits, fetchAdminCanonicalProgress } from "@/lib/adminCanonicalProgress";

type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
type CoachProfileRow = Database["public"]["Tables"]["coach_profiles"]["Row"];
type AllowlistRow = Database["public"]["Tables"]["coachee_coach_allowlist"]["Row"];
type SessionRow = Database["public"]["Tables"]["sessions"]["Row"];
type CoachAsCoacheeAllowlistRow = Database["public"]["Tables"]["coach_as_coachee_allowlist"]["Row"];
type UserRoleRow = Database["public"]["Tables"]["user_roles"]["Row"];

/**
 * Loads and manages the admin registrations list (coachees + coaches),
 */
export function useAdminRegistrations() {
  const [loading, setLoading] = useState(true);
  const [coachees, setCoachees] = useState<CoacheeRow[]>([]);
  const [coaches, setCoaches] = useState<CoachListRow[]>([]);
  const [coachOpts, setCoachOpts] = useState<CoachOpt[]>([]);

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
      { data: allowlist },
      { data: sess },
      { data: cps },
      { data: programmeEnrollments },
      { data: coachAllow },
    ] = await Promise.all([
      supabase.from("profiles").select("id, full_name, email, status, created_at"),
      supabase.from("coachee_coach_allowlist").select("coachee_id, coach_id"),
      supabase.from("sessions").select("id, coach_id, coachee_id, enrollment_id, status"),
      supabase.from("coach_profiles").select("*"),
       supabase.from("programme_enrollments").select("id, user_id, programme_id, status, start_date, programmes(name)").in("status", ["active", "at_risk", "paused"]),
      supabase.from("coach_as_coachee_allowlist").select("coach_user_id, selectable_coach_id"),
    ]);

    const profilesData = (profiles || []) as Pick<
      ProfileRow,
      "id" | "full_name" | "email" | "status" | "created_at"
    >[];
    const allowlistData = (allowlist || []) as Pick<AllowlistRow, "coachee_id" | "coach_id">[];
    const sessData = (sess || []) as Pick<SessionRow, "id" | "coach_id" | "coachee_id" | "enrollment_id" | "status">[];
    const cpsData = (cps || []) as CoachProfileRow[];
    const coachAllowData = (coachAllow || []) as Pick<
      CoachAsCoacheeAllowlistRow,
      "coach_user_id" | "selectable_coach_id"
    >[];

    const profilesById = new Map(profilesData.map((p) => [p.id, p]));
    const cpById = new Map(cpsData.map((c) => [c.id, c]));


    const bookedByCoachee = new Map<string, number>();
    const doneByCoachee = new Map<string, number>();
    sessData.forEach((s) => {
      if (s.enrollment_id && ["pending_coach_approval", "confirmed"].includes(s.status)) {
        bookedByCoachee.set(s.coachee_id, (bookedByCoachee.get(s.coachee_id) || 0) + 1);
      }
      if (s.enrollment_id && s.status === "completed") {
        doneByCoachee.set(s.coachee_id, (doneByCoachee.get(s.coachee_id) || 0) + 1);
      }
    });

    // Per-coach completed sessions and unique coachees (confirmed/completed)
    const coachCompletedById = new Map<string, number>();
    const coachCoacheesById = new Map<string, Set<string>>();
    sessData.forEach((s) => {
      if (s.enrollment_id && s.status === "completed") {
        coachCompletedById.set(s.coach_id, (coachCompletedById.get(s.coach_id) || 0) + 1);
      }
      if (s.enrollment_id && ["confirmed", "completed"].includes(s.status)) {
        const set = coachCoacheesById.get(s.coach_id) || new Set<string>();
        set.add(s.coachee_id);
        coachCoacheesById.set(s.coach_id, set);
      }
    });

    const coachNameById = new Map<string, string>();
    coachIds.forEach((cid) => {
      const p = profilesById.get(cid);
      if (p) coachNameById.set(cid, p.full_name);
    });

    const allowByCoachee = new Map<string, { id: string; name: string }[]>();
    allowlistData.forEach((a) => {
      const arr = allowByCoachee.get(a.coachee_id) || [];
      arr.push({ id: a.coach_id, name: coachNameById.get(a.coach_id) || "—" });
      allowByCoachee.set(a.coachee_id, arr);
    });

    const coacheeRows: CoacheeRow[] = coacheeIds
      .map((id): CoacheeRow | null => {
        const p = profilesById.get(id);
        if (!p) return null;
        return {
          id,
          full_name: p.full_name,
          email: p.email,
          status: p.status as Status,
          created_at: p.created_at,
          booked: bookedByCoachee.get(id) || 0,
          done: doneByCoachee.get(id) || 0,
          selected_coaches: allowByCoachee.get(id) || [],
        };
      })
      .filter((row): row is CoacheeRow => row !== null);

    const enrollmentByCoach = new Map<string, NonNullable<typeof programmeEnrollments>[number]>();
    for (const userId of coachIds) {
      const enrollmentId = resolveCurrentEnrollment(
        (programmeEnrollments || []).filter((e) => e.user_id === userId).map((e) => ({
          id: e.id,
          status: e.status,
          start_date: e.start_date,
        })),
      );
      const enrollment = (programmeEnrollments || []).find((e) => e.id === enrollmentId);
      if (enrollment) enrollmentByCoach.set(userId, enrollment);
    }

    // Coach as learner: the canonical module rows of their own enrollment --
    // never a module config allowance or a local session count.
    const canonical = await fetchAdminCanonicalProgress([...enrollmentByCoach.values()].map((e) => e.id)).catch(() => []);
    const canonicalByEnrollment = new Map(canonical.map((c) => [c.enrollment_id, c]));

    // Assigned coaches (for coach-as-coachee)
    const assignedByCoach = new Map<string, { id: string; name: string }[]>();
    coachAllowData.forEach((a) => {
      const arr = assignedByCoach.get(a.coach_user_id) || [];
      arr.push({ id: a.selectable_coach_id, name: coachNameById.get(a.selectable_coach_id) || "—" });
      assignedByCoach.set(a.coach_user_id, arr);
    });

    const coachRows: CoachListRow[] = coachIds
      .map((id): CoachListRow | null => {
        const p = profilesById.get(id);
        const cp = cpById.get(id);
        if (!p) return null;
        const enr = enrollmentByCoach.get(id);
        const canonicalRow = enr ? canonicalByEnrollment.get(enr.id) : undefined;
        return {
          id,
          full_name: p.full_name,
          email: p.email,
          title: null,
          status: p.status as Status,
          created_at: p.created_at,
          approval_status: cp?.approval_status || "pending_approval",
          sessions_completed: coachCompletedById.get(id) || 0,
          coachees_count: (coachCoacheesById.get(id) || new Set()).size,
          rating_avg: Number(cp?.rating_avg || 0),
          country_based: cp?.country_based || null,
          years_experience: cp?.years_experience || null,
          coaching_units: canonicalModuleUnits(canonicalRow, "coaching"),
          peer_units: canonicalModuleUnits(canonicalRow, "peer"),
          coach_programme_name: (enr as { programmes?: { name?: string } | null } | undefined)?.programmes?.name ?? null,
          assigned_coaches: assignedByCoach.get(id) || [],
        };
      })
      .filter((row): row is CoachListRow => row !== null);

    setCoachees(coacheeRows.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at)));
    setCoaches(coachRows.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at)));
    setCoachOpts(
      coachIds
        .map((id) => ({ id, name: coachNameById.get(id) || "—" }))
        .filter((c) => c.name !== "—")
        .sort((a, b) => a.name.localeCompare(b.name))
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return {
    loading,
    coachees,
    coaches,
    coachOpts,
    reload: load,
  };
}
