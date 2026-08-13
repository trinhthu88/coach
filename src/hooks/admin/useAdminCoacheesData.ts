import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import type { Row, Status } from "@/pages/admin/coachees/coacheeDisplay";

export interface ProgrammeOpt {
  id: string;
  name: string;
  coachee_session_limit: number;
  duration_months: number;
}

export interface NamedOpt {
  id: string;
  name: string;
}

/**
 * Loads the full admin coachees list — profile, session counts, programme/
 * cohort/organization enrollment, coach allowlist and session-limit override
 * for every coachee — plus the option lists (coaches/programmes/cohorts/
 * organizations) used to edit a row.
 */
export function useAdminCoacheesData() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [coachOpts, setCoachOpts] = useState<NamedOpt[]>([]);
  const [programmes, setProgrammes] = useState<ProgrammeOpt[]>([]);
  const [cohorts, setCohorts] = useState<NamedOpt[]>([]);
  const [organizations, setOrganizations] = useState<NamedOpt[]>([]);
  const [defaultLimit, setDefaultLimit] = useState(4);

  const load = useCallback(async () => {
    setLoading(true);
    const [
      { data: roles },
      { data: profiles },
      { data: sess },
      { data: enrolls },
      { data: progs },
      { data: cohortsData },
      { data: orgsData },
      { data: allow },
      { data: limits },
      { data: requests },
    ] = await Promise.all([
      supabase.from("user_roles").select("user_id, role"),
      supabase.from("profiles").select("id, full_name, email, status, created_at"),
      supabase.from("sessions").select("coachee_id, status"),
      supabase.from("programme_enrollments").select("id, coachee_id, programme_id, cohort_id, organization_id, start_date"),
      supabase.from("programmes").select("id, name, coachee_session_limit, duration_months").eq("is_active", true),
      supabase.from("cohorts").select("id, name"),
      supabase.from("organizations").select("id, name").order("name"),
      supabase.from("coachee_coach_allowlist").select("coachee_id, coach_id"),
      supabase.from("session_limits").select("id, coachee_id, monthly_limit"),
      supabase.from("access_requests").select("id, email, status").eq("status", "approved"),
    ]);

    const coacheeIds = (roles || []).filter((r) => r.role === "coachee").map((r) => r.user_id);
    const coachIds = (roles || []).filter((r) => r.role === "coach").map((r) => r.user_id);
    const profById = new Map((profiles || []).map((p) => [p.id, p]));
    const coachNameById = new Map<string, string>();
    coachIds.forEach((id) => {
      const p = profById.get(id);
      if (p) coachNameById.set(id, p.full_name);
    });
    const enrByUser = new Map<string, Pick<Tables<"programme_enrollments">, "id" | "coachee_id" | "programme_id" | "cohort_id" | "organization_id" | "start_date">>();
    (enrolls || []).forEach((e) => enrByUser.set(e.coachee_id, e));
    const progById = new Map((progs || []).map((p) => [p.id, p]));
    const cohortById = new Map((cohortsData || []).map((c) => [c.id, c.name]));
    const orgById = new Map((orgsData || []).map((o) => [o.id, o.name]));
    const allowByCoachee = new Map<string, { id: string; name: string }[]>();
    (allow || []).forEach((a) => {
      const arr = allowByCoachee.get(a.coachee_id) || [];
      arr.push({ id: a.coach_id, name: coachNameById.get(a.coach_id) || "—" });
      allowByCoachee.set(a.coachee_id, arr);
    });
    const done = new Map<string, number>();
    const booked = new Map<string, number>();
    (sess || []).forEach((s) => {
      if (s.status === "completed") done.set(s.coachee_id, (done.get(s.coachee_id) || 0) + 1);
      if (["pending_coach_approval", "confirmed"].includes(s.status)) booked.set(s.coachee_id, (booked.get(s.coachee_id) || 0) + 1);
    });
    const defLimit = (limits || []).find((l) => l.coachee_id === null)?.monthly_limit ?? 4;
    setDefaultLimit(defLimit);
    const limByCoachee = new Map<string, Pick<Tables<"session_limits">, "id" | "coachee_id" | "monthly_limit">>();
    (limits || []).filter((l) => l.coachee_id).forEach((l) => limByCoachee.set(l.coachee_id as string, l));
    const requestIdByEmail = new Map<string, string>();
    (requests || []).forEach((r) => {
      if (!requestIdByEmail.has(String(r.email).toLowerCase())) {
        requestIdByEmail.set(String(r.email).toLowerCase(), r.id);
      }
    });

    const out: Row[] = coacheeIds
      .map((id) => {
        const p = profById.get(id);
        if (!p) return null;
        const enr = enrByUser.get(id);
        const lim = limByCoachee.get(id);
        const prog = enr?.programme_id ? progById.get(enr.programme_id) : null;
        return {
          id,
          full_name: p.full_name,
          email: p.email,
          status: p.status as Status,
          created_at: p.created_at,
          booked: booked.get(id) || 0,
          done: done.get(id) || 0,
          programme_id: enr?.programme_id || null,
          programme_name: prog?.name || null,
          programme_default_limit: prog?.coachee_session_limit ?? null,
          programme_duration_months: prog?.duration_months ?? null,
          cohort_id: enr?.cohort_id || null,
          cohort_name: enr?.cohort_id ? (cohortById.get(enr.cohort_id) as string) || null : null,
          organization_id: enr?.organization_id || null,
          organization_name: enr?.organization_id ? orgById.get(enr.organization_id) || null : null,
          enrollment_id: enr?.id || null,
          enrollment_start_date: enr?.start_date || null,
          selected_coaches: allowByCoachee.get(id) || [],
          session_limit: lim?.monthly_limit ?? defLimit,
          limit_row_id: lim?.id || null,
          access_request_id: requestIdByEmail.get(String(p.email).toLowerCase()) ?? null,
        } as Row;
      })
      .filter(Boolean) as Row[];

    setRows(out.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at)));
    setCoachOpts(
      coachIds
        .map((id) => ({ id, name: coachNameById.get(id) || "—" }))
        .filter((c) => c.name !== "—")
        .sort((a, b) => a.name.localeCompare(b.name))
    );
    setProgrammes((progs || []) as ProgrammeOpt[]);
    setCohorts((cohortsData || []) as NamedOpt[]);
    setOrganizations((orgsData || []) as NamedOpt[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { loading, rows, coachOpts, programmes, cohorts, organizations, defaultLimit, load };
}
