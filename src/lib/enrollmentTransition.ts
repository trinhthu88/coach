import { supabase } from "@/integrations/supabase/client";

// Part 2 of the enrollment-cardinality fix: ux_programme_enrollments_one_active
// (20260830150000_*, re-keyed onto user_id by 20260903100100_unify_enrollments.sql)
// rejects a second 'active' row for the same person, so admin UI that changes
// someone's programme must close out the old active row first, not bare-insert
// or update the programme_id in place — the latter would silently lose history
// (the old programme just disappears instead of showing as completed).
//
// Changing only cohort/organization (not the programme itself) still updates
// in place — that's not a programme change, there's nothing to transition.
//
// This is now the ONE enrollment path for both coachees and coaches — coaches
// enroll in the same programmes/programme_enrollments table (as user_id),
// with coach-side session limits and give/receive config living in
// programme_modules instead of the deprecated coach_programmes /
// coach_programme_enrollments tables.

const todayISO = () => new Date().toISOString().slice(0, 10);

interface EnrollmentFields {
  programme_id: string;
  cohort_id?: string | null;
  organization_id?: string | null;
}

export async function upsertCoacheeEnrollment(
  userId: string,
  existing: { id: string; programme_id: string | null } | null,
  fields: EnrollmentFields
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
  return supabase.from("programme_enrollments").insert({ user_id: userId, status: "active", ...fields });
}
