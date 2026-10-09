import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export type Enrollment = Pick<
  Tables<"programme_enrollments">,
  "id" | "user_id" | "programme_id" | "cohort_id" | "organization_id" | "start_date" | "end_date" | "status"
>;

export type OngoingEnrollmentStatus = "active" | "at_risk" | "paused";

export interface OngoingEnrollmentConflict {
  enrollmentId: string;
  programmeId: string;
  programmeName?: string;
  cohortId: string | null;
  cohortName?: string | null;
  status: OngoingEnrollmentStatus;
  startDate: string;
  endDate: string | null;
}

export type EnrollmentSelectionResult =
  | { kind: "selected"; enrollment: Enrollment }
  | { kind: "missing" }
  | { kind: "invalid"; enrollmentId: string };

export interface CreateProgrammeEnrollmentInput {
  userId: string;
  programmeId: string;
  cohortId: string;
  organizationId: string;
  startDate?: string;
  endDate?: string;
}

type ProgrammeEnrollmentRpcClient = {
  rpc: (
    name: "create_programme_enrollment",
    args: {
      p_user_id: string;
      p_programme_id: string;
      p_cohort_id: string;
      p_organization_id: string;
      p_start_date?: string;
      p_end_date?: string;
    }
  ) => Promise<{ data: Enrollment | null; error: unknown }>;
};

export type EnrollmentCreationResult =
  | { kind: "created"; enrollment: Enrollment }
  | { kind: "conflict"; conflict: OngoingEnrollmentConflict }
  | { kind: "error"; error: unknown };

const ongoingStatuses = new Set<OngoingEnrollmentStatus>(["active", "at_risk", "paused"]);

export function isOngoingEnrollment(status: Enrollment["status"]): status is OngoingEnrollmentStatus {
  return ongoingStatuses.has(status as OngoingEnrollmentStatus);
}

export function enrollmentQueryKey(resource: string, enrollmentId: string | undefined) {
  return [resource, enrollmentId ?? null] as const;
}

export function resolveSelectedEnrollment(
  enrollments: Enrollment[],
  selectedEnrollmentId?: string | null,
  currentEnrollmentId?: string | null
): Enrollment | null {
  const result = resolveSelectedEnrollmentResult(enrollments, selectedEnrollmentId, currentEnrollmentId);
  return result.kind === "selected" ? result.enrollment : null;
}

/**
 * Resolve ownership without guessing. An explicitly selected enrollment is
 * used as is; otherwise only the server's current enrollment
 * (learner_current_enrollment: enrollment_is_ongoing -- active AND inside its
 * dates) is chosen. Status alone never makes an enrollment current: a paused
 * or past-end enrollment is not.
 */
export function resolveSelectedEnrollmentResult(
  enrollments: Enrollment[],
  selectedEnrollmentId?: string | null,
  currentEnrollmentId?: string | null
): EnrollmentSelectionResult {
  const id = selectedEnrollmentId || currentEnrollmentId;
  if (!id) return { kind: "missing" };
  const enrollment = enrollments.find((candidate) => candidate.id === id);
  return enrollment ? { kind: "selected", enrollment } : { kind: "invalid", enrollmentId: id };
}

export function parseOngoingEnrollmentConflict(error: unknown): OngoingEnrollmentConflict | null {
  if (!error || typeof error !== "object") return null;
  const candidate = error as { message?: unknown; details?: unknown };
  const raw = typeof candidate.message === "string" ? candidate.message : typeof candidate.details === "string" ? candidate.details : null;
  if (!raw) return null;

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }

  if (
    payload.code !== "ongoing_enrollment_exists" ||
    typeof payload.enrollment_id !== "string" ||
    typeof payload.programme_id !== "string" ||
    typeof payload.start_date !== "string" ||
    typeof payload.status !== "string" ||
    !ongoingStatuses.has(payload.status as OngoingEnrollmentStatus)
  ) {
    return null;
  }

  return {
    enrollmentId: payload.enrollment_id,
    programmeId: payload.programme_id,
    programmeName: typeof payload.programme_name === "string" ? payload.programme_name : undefined,
    cohortId: typeof payload.cohort_id === "string" ? payload.cohort_id : null,
    cohortName: typeof payload.cohort_name === "string" ? payload.cohort_name : null,
    status: payload.status as OngoingEnrollmentStatus,
    startDate: payload.start_date,
    endDate: typeof payload.end_date === "string" ? payload.end_date : null,
  };
}

export async function createProgrammeEnrollment(
  client: ProgrammeEnrollmentRpcClient,
  input: CreateProgrammeEnrollmentInput
): Promise<EnrollmentCreationResult> {
  const { data, error } = await client.rpc("create_programme_enrollment", {
    p_user_id: input.userId,
    p_programme_id: input.programmeId,
    p_cohort_id: input.cohortId,
    p_organization_id: input.organizationId,
    ...(input.startDate ? { p_start_date: input.startDate } : {}),
    ...(input.endDate ? { p_end_date: input.endDate } : {}),
  });

  if (error) {
    const conflict = parseOngoingEnrollmentConflict(error);
    return conflict ? { kind: "conflict", conflict } : { kind: "error", error };
  }
  if (!data) return { kind: "error", error: new Error("Enrollment creation returned no enrollment") };
  return { kind: "created", enrollment: data };
}

export function createEnrollment(input: CreateProgrammeEnrollmentInput) {
  return createProgrammeEnrollment(supabase as unknown as ProgrammeEnrollmentRpcClient, input);
}

export async function getEnrollmentHistory(userId: string): Promise<Enrollment[]> {
  const { data, error } = await supabase
    .from("programme_enrollments")
    .select("id, user_id, programme_id, cohort_id, organization_id, start_date, end_date, status")
    .eq("user_id", userId)
    .order("start_date", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** How the server says the shown enrollment stands: current, or read-only as paused / ended / upcoming. */
export type EnrollmentDisplayState = "current" | "paused" | "ended" | "upcoming";

export interface DisplayEnrollment {
  enrollmentId: string;
  /** enrollment_is_ongoing: the learner can act (book, submit) in it. */
  isCurrent: boolean;
  displayState: EnrollmentDisplayState;
}

/**
 * Whether a learner page may offer actions (Book, Submit, Schedule, Resubmit):
 * only when the server says the shown enrollment is current. Unknown (null)
 * leaves the page as it was; the server refuses any action that is not allowed.
 */
export function canActOn(isCurrent: boolean | null | undefined): boolean {
  return isCurrent !== false;
}

/**
 * The enrollment the signed-in learner's pages SHOW (learner_display_enrollment):
 * the current one, else their latest, flagged read-only. What they may DO is
 * still learner_current_enrollment's (is_current); the server refuses the rest.
 */
export async function getDisplayEnrollment(): Promise<DisplayEnrollment | null> {
  const { data, error } = await supabase.rpc("learner_display_enrollment");
  if (error) throw error;
  const row = data?.[0];
  return row
    ? { enrollmentId: row.enrollment_id, isCurrent: row.is_current, displayState: row.display_state as EnrollmentDisplayState }
    : null;
}

/** Admin: every learner's current enrollment (the learner's own answer) and latest record. */
export async function fetchAdminCurrentEnrollments(): Promise<
  Map<string, { currentEnrollmentId: string | null; latestEnrollmentId: string | null }>
> {
  const { data, error } = await supabase.rpc("admin_current_enrollments");
  if (error) throw error;
  return new Map(
    (data ?? []).map((row) => [
      row.user_id,
      { currentEnrollmentId: row.enrollment_id ?? null, latestEnrollmentId: row.latest_enrollment_id ?? null },
    ])
  );
}
