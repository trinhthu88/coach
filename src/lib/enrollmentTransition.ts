import {
  createProgrammeEnrollment,
  type CreateProgrammeEnrollmentInput,
  type EnrollmentCreationResult,
} from "@/lib/enrollments";

type ProgrammeEnrollmentRpcClient = Parameters<typeof createProgrammeEnrollment>[0];

/**
 * The only application path for a new enrollment. The database RPC owns the
 * concurrency-safe ongoing-enrollment rule. This function never updates,
 * completes, cancels, or deletes an existing enrollment.
 */
export function requestAdminEnrollment(
  input: CreateProgrammeEnrollmentInput,
  client?: ProgrammeEnrollmentRpcClient
): Promise<EnrollmentCreationResult> {
  if (client) return createProgrammeEnrollment(client, input);
  return import("@/lib/enrollments").then(({ createEnrollment }) => createEnrollment(input));
}

export interface EnrollmentTransitionInput {
  userId: string;
  /** Optional: the cohort owns the programme; a conflicting value is rejected by the RPC. */
  programmeId?: string | null;
  cohortId: string;
  /** Optional: defaults to the cohort's organization. */
  organizationId?: string | null;
  /** YYYY-MM-DD; defaults to today in the database. */
  effectiveDate?: string;
}

export type EnrollmentTransitionAction = "created" | "transitioned" | "organization_updated" | "unchanged";

export interface EnrollmentTransitionResult {
  action: EnrollmentTransitionAction;
  enrollment_id: string;
  closed_enrollment_id?: string | null;
}

type TransitionRpcClient = {
  rpc: (
    name: "admin_transition_enrollment",
    args: {
      p_user_id: string;
      p_programme_id?: string | null;
      p_cohort_id: string;
      p_organization_id?: string | null;
      p_effective_date?: string;
    }
  ) => PromiseLike<{ data: unknown; error: unknown }>;
};

/**
 * The admin path for changing a person's programme / cohort / organization
 * after creation (admin_transition_enrollment). One transaction: an ongoing
 * enrollment elsewhere is closed (status 'completed', ended_reason
 * 'transferred', history kept) and the new one is created through the
 * validated writer; an organization-only change corrects the current
 * enrollment in place.
 */
export async function transitionAdminEnrollment(
  input: EnrollmentTransitionInput,
  client?: TransitionRpcClient
): Promise<EnrollmentTransitionResult> {
  const rpcClient = client ?? ((await import("@/integrations/supabase/client")).supabase as unknown as TransitionRpcClient);
  const { data, error } = await rpcClient.rpc("admin_transition_enrollment", {
    p_user_id: input.userId,
    p_programme_id: input.programmeId ?? null,
    p_cohort_id: input.cohortId,
    p_organization_id: input.organizationId ?? null,
    ...(input.effectiveDate ? { p_effective_date: input.effectiveDate } : {}),
  });
  if (error) throw error;
  return data as EnrollmentTransitionResult;
}
