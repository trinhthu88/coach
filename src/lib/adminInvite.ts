import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { extractFunctionError } from "@/lib/errors";
import type {
  InviteOffer,
  InviteRowInput,
  PreviewStatus,
  ValidatedInviteRow,
} from "../../supabase/functions/_shared/adminInviteRules";

// Client for the ONE admin provisioning service (edge function
// admin-provision-user -> supabase/functions/_shared/adminInvite.ts). Single
// add, sponsor creation, bulk import and "resend setup link" all go through it.

export type { InviteOffer, InviteRowInput, PreviewStatus };
export { normalizeSheetRow } from "../../supabase/functions/_shared/adminInviteRules";

export type AdminInviteRole = "coachee" | "coach" | "sponsor" | "admin";

export interface AdminInvitePreviewRow extends Omit<ValidatedInviteRow, "assign_coach_id"> {
  programme_name: string | null;
  cohort_name: string | null;
  organization_name: string | null;
}

export type AdminInviteResultStatus = "invited" | "enrolled" | "linked" | "partial" | "failed" | "skipped";

export interface AdminInviteRowResult {
  row_index: number;
  row_id?: string;
  email: string;
  status: AdminInviteResultStatus;
  message?: string;
  user_id?: string;
  enrollment_id?: string;
  email_sent?: boolean;
}

export interface AdminInviteRunResult {
  batch_id: string | null;
  preview: AdminInvitePreviewRow[];
  results: AdminInviteRowResult[];
}

export type InviteBatch = Database["public"]["Tables"]["bulk_invite_batches"]["Row"];
export type InviteBatchRow = Database["public"]["Tables"]["bulk_invite_rows"]["Row"];

/** Problem statuses: the row cannot run (organization_mismatch is only a warning). */
export function isProblemStatus(status: PreviewStatus): boolean {
  return status !== "valid" && status !== "existing_user" && status !== "organization_mismatch";
}

/** Whether a preview row would run on confirm, given the offers the admin accepted. */
export function isExecutableRow(row: Pick<AdminInvitePreviewRow, "action" | "offer" | "row_index">, accepted: Set<number>): boolean {
  return row.action !== "skip" || (row.offer !== null && accepted.has(row.row_index));
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("admin-provision-user", { body });
  if (error) throw await extractFunctionError(error);
  const payload = data as T & { error?: string };
  if (payload && typeof payload === "object" && "error" in payload && payload.error) throw new Error(payload.error);
  return payload;
}

/** Dry run: validates rows and reports what would happen. Writes nothing. */
export async function previewAdminInvite(rows: InviteRowInput[]): Promise<AdminInvitePreviewRow[]> {
  const result = await invoke<AdminInviteRunResult>({ action: "preview", rows });
  return result.preview;
}

/** Executes rows (re-validated server-side). `track` records a resumable bulk batch. */
export function executeAdminInvite(
  rows: InviteRowInput[],
  options: { track?: boolean; batchId?: string | null } = {},
): Promise<AdminInviteRunResult> {
  return invoke<AdminInviteRunResult>({
    action: "execute",
    rows,
    track: options.track === true,
    batchId: options.batchId ?? undefined,
  });
}

/** Emails a fresh account-setup link (invite or recovery). Never a password. */
export function resendSetupLink(userId: string): Promise<{ email: string; full_name: string; email_sent: boolean; error?: string }> {
  return invoke({ action: "resend_setup_link", user_id: userId });
}

export async function fetchRecentInviteBatches(limit = 8): Promise<InviteBatch[]> {
  const { data, error } = await supabase
    .from("bulk_invite_batches")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function fetchInviteBatchRows(batchId: string): Promise<InviteBatchRow[]> {
  const { data, error } = await supabase
    .from("bulk_invite_rows")
    .select("*")
    .eq("batch_id", batchId)
    .order("row_index");
  if (error) throw error;
  return data ?? [];
}

/** Rebuilds a request row from a tracked batch row (resume / retry keeps the confirmed values). */
export function inviteRowFromBatchRow(r: InviteBatchRow): InviteRowInput {
  return {
    row_id: r.id,
    email: r.email ?? "",
    full_name: r.full_name ?? "",
    role: r.role ?? "coachee",
    cohort: r.cohort_id ?? undefined,
    programme: r.programme_id ?? undefined,
    organization: r.organization_id ?? undefined,
    title: r.title ?? undefined,
    department: r.department ?? undefined,
    accept_existing: r.accept_existing,
    assign_coach_id: r.assign_coach_id ?? undefined,
  };
}
