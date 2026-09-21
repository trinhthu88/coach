import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { fetchAdminCanonicalProgress, type AdminCanonicalProgressRow } from "@/lib/adminCanonicalProgress";
import { toLearnerReflection, type LearnerReflection } from "@/hooks/journey/useLearnerReflectionFeed";

type Fn = Database["public"]["Functions"];

export type AdminUserEnrollment = Fn["admin_user_enrollments"]["Returns"][number];
export type AdminModuleProgressRow = Fn["admin_enrollment_module_progress"]["Returns"][number];
export type AdminEngagementRow = Fn["admin_enrollment_engagement"]["Returns"][number];
export type AdminGoalRow = Fn["admin_enrollment_goals"]["Returns"][number];
export type AdminGoalCheckinRow = Fn["admin_enrollment_goal_checkins"]["Returns"][number];
export type AdminActionRow = Fn["admin_enrollment_actions"]["Returns"][number];
export type AdminSessionRow = Fn["admin_learner_session_history"]["Returns"][number];

export interface AdminUserProfile {
  id: string;
  full_name: string;
  email: string;
  avatar_url: string | null;
}

/** Enrollments that are still running (the partial unique index's "ongoing" set). */
export const ONGOING_STATUSES: ReadonlyArray<AdminUserEnrollment["stored_enrollment_status"]> = ["active", "at_risk", "paused"];

async function fetchAdminUser(userId: string): Promise<{ profile: AdminUserProfile | null; enrollments: AdminUserEnrollment[] }> {
  const [{ data: profile, error: profileError }, { data: enrollments, error: enrollmentsError }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email, avatar_url").eq("id", userId).maybeSingle(),
    supabase.rpc("admin_user_enrollments", { p_user_id: userId }),
  ]);
  if (profileError) throw profileError;
  if (enrollmentsError) throw enrollmentsError;
  return { profile: (profile as AdminUserProfile | null) ?? null, enrollments: enrollments ?? [] };
}

/**
 * The person and EVERY enrollment they have had (newest first), each with the
 * canonical effective status from canonical_enrollment_progress — via
 * admin_user_enrollments. Works for users with only past enrollments or none.
 */
export function useAdminUser(userId: string | undefined) {
  return useQuery({
    queryKey: ["admin-user-detail", userId ?? null],
    queryFn: () => fetchAdminUser(userId as string),
    enabled: !!userId,
    staleTime: 30_000,
  });
}

export interface AdminEnrollmentDetail {
  progress: AdminCanonicalProgressRow | null;
  modules: AdminModuleProgressRow[];
  engagement: AdminEngagementRow | null;
  goals: AdminGoalRow[];
  checkins: AdminGoalCheckinRow[];
  actions: AdminActionRow[];
  sessions: AdminSessionRow[];
  reflections: LearnerReflection[];
}

function unwrap<T>(result: { data: T | null; error: unknown }): T {
  if (result.error) throw result.error;
  return result.data as T;
}

/**
 * One enrollment's canonical detail. Every read is an admin_* wrapper over
 * the engine the learner and sponsor read — nothing is recomputed here:
 *   admin_canonical_enrollment_progress → canonical_enrollment_progress
 *   admin_enrollment_module_progress    → canonical_module_progress
 *   admin_enrollment_engagement         → canonical_enrollment_engagement
 *   admin_enrollment_goals              → canonical_goal_progress
 *   admin_learner_session_history       → canonical_session_history
 *   admin_learner_reflection_feed       → canonical_reflection_feed
 */
async function fetchAdminEnrollmentDetail(enrollmentId: string): Promise<AdminEnrollmentDetail> {
  const p = { p_enrollment_id: enrollmentId };
  const [progress, modules, engagement, goals, checkins, actions, sessions, reflections] = await Promise.all([
    fetchAdminCanonicalProgress([enrollmentId]),
    supabase.rpc("admin_enrollment_module_progress", p),
    supabase.rpc("admin_enrollment_engagement", p),
    supabase.rpc("admin_enrollment_goals", p),
    supabase.rpc("admin_enrollment_goal_checkins", p),
    supabase.rpc("admin_enrollment_actions", p),
    supabase.rpc("admin_learner_session_history", p),
    supabase.rpc("admin_learner_reflection_feed", p),
  ]);
  return {
    progress: progress[0] ?? null,
    modules: unwrap(modules) ?? [],
    engagement: (unwrap(engagement) ?? [])[0] ?? null,
    goals: unwrap(goals) ?? [],
    checkins: unwrap(checkins) ?? [],
    actions: unwrap(actions) ?? [],
    sessions: unwrap(sessions) ?? [],
    reflections: (unwrap(reflections) ?? []).map(toLearnerReflection),
  };
}

/** Lazily loaded: only runs while the enrollment's section is open. */
export function useAdminEnrollmentDetail(enrollmentId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["admin-enrollment-detail", enrollmentId ?? null],
    queryFn: () => fetchAdminEnrollmentDetail(enrollmentId as string),
    enabled: !!enrollmentId && enabled,
    staleTime: 30_000,
  });
}
