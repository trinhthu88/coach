import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { CoachListRow, CoachOpt, CoacheeRow, Status } from "./types";

type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
type CoachProfileRow = Database["public"]["Tables"]["coach_profiles"]["Row"];
type SessionLimitRow = Database["public"]["Tables"]["session_limits"]["Row"];
type AllowlistRow = Database["public"]["Tables"]["coachee_coach_allowlist"]["Row"];
type SessionRow = Database["public"]["Tables"]["sessions"]["Row"];
type PeerSessionRow = Database["public"]["Tables"]["peer_sessions"]["Row"];
type CoachAsCoacheeAllowlistRow = Database["public"]["Tables"]["coach_as_coachee_allowlist"]["Row"];
type UserRoleRow = Database["public"]["Tables"]["user_roles"]["Row"];

/**
 * Loads and manages the admin registrations list (coachees + coaches),
 * including the per-list default session limits used as fallbacks.
 */
export function useAdminRegistrations() {
  const [loading, setLoading] = useState(true);
  const [coachees, setCoachees] = useState<CoacheeRow[]>([]);
  const [coaches, setCoaches] = useState<CoachListRow[]>([]);
  const [coachOpts, setCoachOpts] = useState<CoachOpt[]>([]);
  const [defaultLimit, setDefaultLimit] = useState(4);

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
      { data: limits },
      { data: allowlist },
      { data: sess },
      { data: cps },
      { data: coachEnrollments },
      { data: peerSess },
      { data: coachAllow },
    ] = await Promise.all([
      supabase.from("profiles").select("id, full_name, email, status, created_at"),
      supabase.from("session_limits").select("coachee_id, monthly_limit"),
      supabase.from("coachee_coach_allowlist").select("coachee_id, coach_id"),
      supabase.from("sessions").select("id, coach_id, coachee_id, status"),
      supabase.from("coach_profiles").select("*"),
      supabase.from("coach_programme_enrollments").select("coach_id, coach_programme:coach_programmes(name, mentee_sessions_limit, peer_received_limit)"),
      supabase.from("peer_sessions").select("id, peer_coach_id, peer_coachee_id, status"),
      supabase.from("coach_as_coachee_allowlist").select("coach_user_id, selectable_coach_id"),
    ]);

    const profilesData = (profiles || []) as Pick<
      ProfileRow,
      "id" | "full_name" | "email" | "status" | "created_at"
    >[];
    const limitsData = (limits || []) as Pick<SessionLimitRow, "coachee_id" | "monthly_limit">[];
    const allowlistData = (allowlist || []) as Pick<AllowlistRow, "coachee_id" | "coach_id">[];
    const sessData = (sess || []) as Pick<SessionRow, "id" | "coach_id" | "coachee_id" | "status">[];
    const cpsData = (cps || []) as CoachProfileRow[];
    const peerSessData = (peerSess || []) as Pick<
      PeerSessionRow,
      "id" | "peer_coach_id" | "peer_coachee_id" | "status"
    >[];
    const coachAllowData = (coachAllow || []) as Pick<
      CoachAsCoacheeAllowlistRow,
      "coach_user_id" | "selectable_coach_id"
    >[];

    const profilesById = new Map(profilesData.map((p) => [p.id, p]));
    const cpById = new Map(cpsData.map((c) => [c.id, c]));

    const globalLimit = limitsData.find((l) => l.coachee_id === null)?.monthly_limit ?? 4;
    setDefaultLimit(globalLimit);
    const limitByCoachee = new Map(
      limitsData.filter((l) => l.coachee_id).map((l) => [l.coachee_id as string, l.monthly_limit])
    );

    const bookedByCoachee = new Map<string, number>();
    const doneByCoachee = new Map<string, number>();
    sessData.forEach((s) => {
      if (["pending_coach_approval", "confirmed"].includes(s.status)) {
        bookedByCoachee.set(s.coachee_id, (bookedByCoachee.get(s.coachee_id) || 0) + 1);
      }
      if (s.status === "completed") {
        doneByCoachee.set(s.coachee_id, (doneByCoachee.get(s.coachee_id) || 0) + 1);
      }
    });

    // Per-coach completed sessions and unique coachees (confirmed/completed)
    const coachCompletedById = new Map<string, number>();
    const coachCoacheesById = new Map<string, Set<string>>();
    sessData.forEach((s) => {
      if (s.status === "completed") {
        coachCompletedById.set(s.coach_id, (coachCompletedById.get(s.coach_id) || 0) + 1);
      }
      if (["confirmed", "completed"].includes(s.status)) {
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
          monthly_limit: limitByCoachee.get(id) ?? globalLimit,
          selected_coaches: allowByCoachee.get(id) || [],
        };
      })
      .filter((row): row is CoacheeRow => row !== null);

    const enrollmentByCoach = new Map((coachEnrollments || []).map((e) => [e.coach_id, e]));

    // Coach-as-coachee usage (completed coaching sessions where coach is the coachee)
    const coachAsCoacheeDone = new Map<string, number>();
    sessData.forEach((s) => {
      if (s.status === "completed" && coachIds.includes(s.coachee_id)) {
        coachAsCoacheeDone.set(s.coachee_id, (coachAsCoacheeDone.get(s.coachee_id) || 0) + 1);
      }
    });

    // Peer-as-receiver usage (completed peer sessions)
    const peerReceivedDone = new Map<string, number>();
    peerSessData.forEach((s) => {
      if (s.status === "completed") {
        peerReceivedDone.set(s.peer_coachee_id, (peerReceivedDone.get(s.peer_coachee_id) || 0) + 1);
      }
    });

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
        const prog = enr?.coach_programme;
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
          coach_limit: enr ? prog?.mentee_sessions_limit ?? null : 4,
          coach_used: coachAsCoacheeDone.get(id) || 0,
          peer_limit: enr ? prog?.peer_received_limit ?? null : 4,
          peer_used: peerReceivedDone.get(id) || 0,
          coach_programme_name: prog?.name ?? null,
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
    defaultLimit,
    reload: load,
  };
}
