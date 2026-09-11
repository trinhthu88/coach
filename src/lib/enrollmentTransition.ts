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
