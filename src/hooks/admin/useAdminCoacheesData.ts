import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Row, Status } from "@/pages/admin/coachees/coacheeDisplay";
import { fetchAdminCurrentEnrollments } from "@/lib/enrollments";
import { fetchAdminCanonicalProgress } from "@/lib/adminCanonicalProgress";
import { canonicalCompletionPct } from "@/lib/programmeProfile";

export interface ProgrammeOpt {
  id: string;
  name: string;
  duration_months: number;
}

export interface NamedOpt {
  id: string;
  name: string;
}

/** A cohort owns its programme; organization is the cohort's default. */
export interface CohortOpt extends NamedOpt {
  programme_id: string | null;
  organization_id: string | null;
}

/**
 * Loads the full admin coachees list — profile, session counts, programme/
 * cohort/organization enrollment for every coachee (a learner's Coach is their
 * cohort's Coach pool; the retired coachee_coach_allowlist is not read) — plus the option lists (coaches/programmes/cohorts/
 * organizations) used to edit a row.
 */
export function useAdminCoacheesData() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [coachOpts, setCoachOpts] = useState<NamedOpt[]>([]);
  const [programmes, setProgrammes] = useState<ProgrammeOpt[]>([]);
  const [cohorts, setCohorts] = useState<CohortOpt[]>([]);
  const [organizations, setOrganizations] = useState<NamedOpt[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const [
      { data: roles },
      { data: profiles },
      { data: enrolls },
      { data: progs },
      { data: cohortsData },
      { data: orgsData },
      { data: requests },
      currentByUser,
    ] = await Promise.all([
      supabase.from("user_roles").select("user_id, role"),
      supabase.from("profiles").select("id, full_name, email, status, created_at, spoken_languages"),
      supabase.from("programme_enrollments").select("id, user_id, programme_id, cohort_id, organization_id, start_date, status"),
      supabase.from("programmes").select("id, name, duration_months").eq("is_active", true),
      supabase.from("cohorts").select("id, name, programme_id, organization_id"),
      supabase.from("organizations").select("id, name").order("name"),
      supabase.from("access_requests").select("id, email, status").eq("status", "approved"),
      fetchAdminCurrentEnrollments(),
    ]);

    const coacheeIds = (roles || []).filter((r) => r.role === "coachee").map((r) => r.user_id);
    const coachIds = (roles || []).filter((r) => r.role === "coach").map((r) => r.user_id);
    const profById = new Map((profiles || []).map((p) => [p.id, p]));
    const coachNameById = new Map<string, string>();
    coachIds.forEach((id) => {
      const p = profById.get(id);
      if (p) coachNameById.set(id, p.full_name);
    });
    const enrById = new Map((enrolls || []).map((e) => [e.id, e]));
    // Each person's enrollment as the server resolves it
    // (admin_current_enrollments): the current one -- the learner's own
    // answer, enrollment_is_ongoing -- else their latest record, shown with
    // its own status (a paused learner stays findable). Never chosen here.
    const enrByUser = new Map<string, NonNullable<typeof enrolls>[number]>();
    for (const userId of coacheeIds) {
      const resolved = currentByUser.get(userId);
      const enrollmentId = resolved?.currentEnrollmentId ?? resolved?.latestEnrollmentId ?? null;
      if (enrollmentId) {
        const enrollment = enrById.get(enrollmentId);
        if (enrollment) enrByUser.set(userId, enrollment);
      }
    }
    // "% complete" is the canonical engine's number for the SAME enrollment the
    // learner sees — never a local estimate (time elapsed, session counts).
    const selectedEnrollmentIds = [...enrByUser.values()].map((e) => e.id);
    let progressFailed = false;
    const canonical = await fetchAdminCanonicalProgress(selectedEnrollmentIds).catch((error) => {
      // Never a silent zero: the rows show a "progress unavailable" state.
      console.error("Admin canonical progress failed to load", error);
      progressFailed = true;
      return [];
    });
    const canonicalByEnrollment = new Map(canonical.map((c) => [c.enrollment_id, c]));
    const progById = new Map((progs || []).map((p) => [p.id, p]));
    const cohortById = new Map((cohortsData || []).map((c) => [c.id, c.name]));
    const orgById = new Map((orgsData || []).map((o) => [o.id, o.name]));
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
        const prog = enr?.programme_id ? progById.get(enr.programme_id) : null;
        const progress = enr ? canonicalByEnrollment.get(enr.id) : undefined;
        const available = !!progress?.progress_available;
        return {
          id,
          full_name: p.full_name,
          email: p.email,
          status: p.status as Status,
          created_at: p.created_at,
          // Canonical booked-but-not-held units (capped at what is still
          // required) -- the same figure Sponsor and Learner read, never a
          // count of raw session rows.
          booked: available ? progress!.booked_units : 0,
          completed_units: available ? progress!.completed_units : null,
          required_units: available ? progress!.required_units : null,
          progress_error: !!enr && progressFailed,
          programme_id: enr?.programme_id || null,
          programme_name: prog?.name || null,
          programme_duration_months: prog?.duration_months ?? null,
          cohort_id: enr?.cohort_id || null,
          cohort_name: enr?.cohort_id ? (cohortById.get(enr.cohort_id) as string) || null : null,
          organization_id: enr?.organization_id || null,
          organization_name: enr?.organization_id ? orgById.get(enr.organization_id) || null : null,
          enrollment_id: enr?.id || null,
          enrollment_start_date: enr?.start_date || null,
          // The enrollment's state as every role sees it (effective status from
          // the canonical engine, e.g. at_risk after the programme ends).
          enrollment_status: progress?.effective_enrollment_status ?? enr?.status ?? null,
          completion_pct: available ? canonicalCompletionPct(progress!.full_completion_pct) : null,
          access_request_id: requestIdByEmail.get(String(p.email).toLowerCase()) ?? null,
          spoken_languages: p.spoken_languages?.length ? p.spoken_languages : ["vi"],
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
    setCohorts((cohortsData || []) as CohortOpt[]);
    setOrganizations((orgsData || []) as NamedOpt[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { loading, rows, coachOpts, programmes, cohorts, organizations, load };
}
