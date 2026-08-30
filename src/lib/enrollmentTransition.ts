import { supabase } from "@/integrations/supabase/client";

// Part 2 of the enrollment-cardinality fix: ux_programme_enrollments_one_active
// and ux_coach_programme_enrollments_one_active (20260830150000_*) now reject a
// second 'active' row for the same person, so admin UI that changes someone's
// programme must close out the old active row first, not bare-insert or
// update the programme_id in place — the latter would silently lose history
// (the old programme just disappears instead of showing as completed).
//
// Changing only cohort/organization (not the programme itself) still updates
// in place — that's not a programme change, there's nothing to transition.

const todayISO = () => new Date().toISOString().slice(0, 10);

interface CoacheeEnrollmentFields {
  programme_id: string;
  cohort_id?: string | null;
  organization_id?: string | null;
}

export async function upsertCoacheeEnrollment(
  coacheeId: string,
  existing: { id: string; programme_id: string | null } | null,
  fields: CoacheeEnrollmentFields
) {
  if (existing && existing.programme_id === fields.programme_id) {
    return supabase.from("programme_enrollments").update(fields).eq("id", existing.id);
  }
  if (existing) {
    const { error } = await supabase
      .from("programme_enrollments")
      .update({ status: "completed", end_date: todayISO() })
      .eq("id", existing.id);
    if (error) return { error };
  }
  return supabase.from("programme_enrollments").insert({ coachee_id: coacheeId, status: "active", ...fields });
}

export async function upsertCoachEnrollment(
  coachId: string,
  existing: { id: string; coach_programme_id: string | null } | null,
  coachProgrammeId: string
) {
  if (existing && existing.coach_programme_id === coachProgrammeId) {
    return { error: null };
  }
  if (existing) {
    const { error } = await supabase
      .from("coach_programme_enrollments")
      .update({ status: "completed", end_date: todayISO() })
      .eq("id", existing.id);
    if (error) return { error };
  }
  return supabase
    .from("coach_programme_enrollments")
    .insert({ coach_id: coachId, coach_programme_id: coachProgrammeId, status: "active", start_date: todayISO() });
}
