import { useMutation, useQuery, useQueries, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { parseAssessmentFiles, type AssessmentFile, type AssessmentKind, type AssessmentStatus } from "@/lib/assessments";

export { assessmentFileUrl, ASSESSMENT_FILES_BUCKET } from "@/lib/assessments";
export type { AssessmentKind, AssessmentStatus } from "@/lib/assessments";

/**
 * Admin side of the assessment review pipeline (20261006210000).
 *
 * The app holds no privilege on the assessment tables: the pool is read with
 * admin_cohort_assessors and written with admin_set_cohort_assessor, the
 * queue is admin_assessment_queue, and every step is its own function
 * (admin_assign_assessor, admin_validate_review). Status, due dates and
 * timestamps all come from the server.
 */

export const ADMIN_COHORT_ASSESSORS_KEY = "admin-cohort-assessors";
export const ADMIN_ASSESSMENT_QUEUE_KEY = "admin-assessment-queue";

export const ASSESSMENT_STATUSES: AssessmentStatus[] = [
  "awaiting_assignment",
  "with_assessor",
  "awaiting_validation",
  "returned",
  "released",
];

/** Statuses admin_assign_assessor accepts. */
export const ASSIGNABLE_STATUSES: AssessmentStatus[] = ["awaiting_assignment", "with_assessor", "returned"];

export interface CohortAssessorRow {
  coachId: string;
  fullName: string;
  isActive: boolean;
  /** The Coach's account state. An inactive account cannot review anything. */
  accountActive: boolean;
  assignedAt: string | null;
}

/**
 * A cohort's assessor pool plus every other Coach who could join it -- the
 * same Coach population the Mentor pool draws on. An assessor is a Coach with
 * an assessor assignment for this cohort, independent of Coaching and
 * Mentoring.
 */
export function useAdminCohortAssessors(cohortId: string | undefined) {
  return useQuery({
    queryKey: [ADMIN_COHORT_ASSESSORS_KEY, cohortId],
    enabled: !!cohortId,
    queryFn: async (): Promise<CohortAssessorRow[]> => {
      const [{ data: pool, error: pErr }, { data: coachRoles, error: rErr }] = await Promise.all([
        supabase.rpc("admin_cohort_assessors", { p_cohort_id: cohortId! }),
        supabase.from("user_roles").select("user_id").eq("role", "coach"),
      ]);
      if (pErr) throw pErr;
      if (rErr) throw rErr;

      const poolById = new Map((pool ?? []).map((a) => [a.coach_id, a]));
      const roleIds = Array.from(new Set((coachRoles ?? []).map((r) => r.user_id)));
      // Anyone already in the pool stays listed even if their Coach role or
      // account has since changed, so the Admin can see and undo it.
      const ids = Array.from(new Set([...roleIds, ...poolById.keys()]));
      if (ids.length === 0) return [];

      const { data: profiles, error: prErr } = await supabase
        .from("profiles")
        .select("id, full_name, status")
        .in("id", ids);
      if (prErr) throw prErr;
      const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));

      return ids
        .filter((id) => poolById.has(id) || profileById.get(id)?.status === "active")
        .map((id) => {
          const a = poolById.get(id);
          const profile = profileById.get(id);
          return {
            coachId: id,
            fullName: a?.full_name ?? profile?.full_name ?? "Coach",
            isActive: !!a?.is_active,
            accountActive: profile?.status === "active",
            assignedAt: a?.assigned_at ?? null,
          };
        })
        .sort((x, y) => {
          if (x.isActive !== y.isActive) return x.isActive ? -1 : 1;
          return x.fullName.localeCompare(y.fullName);
        });
    },
  });
}

/** Add a Coach to, or remove them from, a cohort's assessor pool. Removing deactivates; open assignments stay. */
export function useSetCohortAssessor(cohortId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ coachId, active }: { coachId: string; active: boolean }) => {
      const { error } = await supabase.rpc("admin_set_cohort_assessor", {
        p_cohort_id: cohortId!,
        p_coach_id: coachId,
        p_active: active,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [ADMIN_COHORT_ASSESSORS_KEY, cohortId] });
    },
  });
}

/**
 * The active pools of several cohorts at once, for the queue's assign picker:
 * a bulk selection can span cohorts, and only a Coach in every selected
 * cohort's pool can take them all.
 */
export function useCohortAssessorPools(cohortIds: string[]) {
  const results = useQueries({
    queries: cohortIds.map((cohortId) => ({
      queryKey: [ADMIN_COHORT_ASSESSORS_KEY, "pool", cohortId],
      queryFn: async () => {
        const { data, error } = await supabase.rpc("admin_cohort_assessors", { p_cohort_id: cohortId });
        if (error) throw error;
        return (data ?? []).filter((a) => a.is_active).map((a) => ({ coachId: a.coach_id, fullName: a.full_name }));
      },
    })),
  });
  const pools = new Map<string, { coachId: string; fullName: string }[]>();
  cohortIds.forEach((id, i) => {
    if (results[i]?.data) pools.set(id, results[i].data!);
  });
  return { pools, loading: results.some((r) => r.isLoading), error: results.some((r) => r.isError) };
}

export interface AssessmentQueueRow {
  submissionId: string;
  enrollmentId: string;
  learnerName: string;
  programmeId: string;
  programmeName: string;
  cohortId: string;
  cohortName: string;
  kind: AssessmentKind;
  requirementOrdinal: number | null;
  attemptNo: number;
  status: AssessmentStatus;
  submittedAt: string;
  assessorId: string | null;
  assessorName: string | null;
  assignedAt: string | null;
  dueOn: string | null;
  reviewOverdue: boolean;
  reviewId: string | null;
  reviewVersion: number | null;
  reviewText: string | null;
  reviewOutcome: "pass" | "not_pass" | "resubmit" | null;
  reviewSubmittedAt: string | null;
  reviewFiles: AssessmentFile[];
  /** The decision on the latest review, if any (a return carries its reason). */
  lastDecision: "approved" | "returned" | null;
  lastReason: string | null;
  releasedAt: string | null;
  viewedAt: string | null;
  /** When the release email went (send-assessment-feedback-email, after Resend accepted it); null = not sent yet. */
  releaseEmailedAt: string | null;
}

export interface AssessmentQueueFilters {
  programmeId?: string | null;
  cohortId?: string | null;
  kind?: AssessmentKind | null;
  status?: AssessmentStatus | null;
}

export function useAdminAssessmentQueue(filters: AssessmentQueueFilters) {
  return useQuery({
    queryKey: [ADMIN_ASSESSMENT_QUEUE_KEY, filters],
    queryFn: async (): Promise<AssessmentQueueRow[]> => {
      const { data, error } = await supabase.rpc("admin_assessment_queue", {
        p_programme_id: filters.programmeId ?? undefined,
        p_cohort_id: filters.cohortId ?? undefined,
        p_kind: filters.kind ?? undefined,
        p_status: filters.status ?? undefined,
      });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        submissionId: r.submission_id,
        enrollmentId: r.enrollment_id,
        learnerName: r.learner_name,
        programmeId: r.programme_id,
        programmeName: r.programme_name,
        cohortId: r.cohort_id,
        cohortName: r.cohort_name,
        kind: r.kind as AssessmentKind,
        requirementOrdinal: r.requirement_ordinal ?? null,
        attemptNo: r.attempt_no,
        status: r.status as AssessmentStatus,
        submittedAt: r.submitted_at,
        assessorId: r.assessor_id ?? null,
        assessorName: r.assessor_name ?? null,
        assignedAt: r.assigned_at ?? null,
        dueOn: r.due_on ?? null,
        reviewOverdue: !!r.review_overdue,
        reviewId: r.review_id ?? null,
        reviewVersion: r.review_version ?? null,
        reviewText: r.review_text ?? null,
        reviewOutcome: (r.review_outcome as AssessmentQueueRow["reviewOutcome"]) ?? null,
        reviewSubmittedAt: r.review_submitted_at ?? null,
        reviewFiles: parseAssessmentFiles(r.review_files),
        lastDecision: (r.last_decision as AssessmentQueueRow["lastDecision"]) ?? null,
        lastReason: r.last_reason ?? null,
        releasedAt: r.released_at ?? null,
        viewedAt: r.viewed_at ?? null,
        releaseEmailedAt: r.release_emailed_at ?? null,
      }));
    },
  });
}

/** Which known server refusal an assessment step hit, so the page can explain it. */
export type AssessmentRefusal = "ownCoach" | "notInPool" | "stale" | "reasonRequired" | null;

export function assessmentRefusal(error: unknown): AssessmentRefusal {
  const message = (error as { message?: unknown } | null)?.message;
  if (typeof message !== "string") return null;
  if (message.includes("own programme coach")) return "ownCoach";
  if (message.includes("assessor pool")) return "notInPool";
  if (message.includes("can no longer be (re)assigned") || message.includes("Only the latest review awaiting validation"))
    return "stale";
  if (message.includes("needs a reason")) return "reasonRequired";
  return null;
}

export function useAdminAssessmentMutations() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: [ADMIN_ASSESSMENT_QUEUE_KEY] });

  const assign = useMutation({
    mutationFn: async ({ submissionIds, assessorId }: { submissionIds: string[]; assessorId: string }) => {
      const { data, error } = await supabase.rpc("admin_assign_assessor", {
        p_submission_ids: submissionIds,
        p_assessor_id: assessorId,
      });
      if (error) throw error;
      return data as number;
    },
    // A bulk call is one transaction: on a refusal nothing changed, but the
    // queue may be stale, so refresh either way.
    onSettled: refresh,
  });

  const validate = useMutation({
    mutationFn: async ({
      reviewId,
      decision,
      reason,
    }: {
      reviewId: string;
      submissionId: string;
      decision: "approved" | "returned";
      reason?: string;
    }) => {
      const { data, error } = await supabase.rpc("admin_validate_review", {
        p_review_id: reviewId,
        p_decision: decision,
        p_reason: reason,
      });
      if (error) throw error;
      return data as string;
    },
    // The release and its in-app notification are committed by
    // admin_validate_review; the email is the server's scheduled sender
    // (send-assessment-feedback-email, 20261007001200), stamped only after
    // Resend accepts it. Nothing is sent from the browser.
    onSettled: refresh,
  });

  return { assign, validate };
}
