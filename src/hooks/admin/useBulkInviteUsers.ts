import { useCallback, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { extractFunctionError } from "@/lib/errors";

export type BulkInviteRole = "coach" | "coachee";

export interface BulkInviteRow {
  row_id?: string;
  email: string;
  full_name: string;
  role: BulkInviteRole;
  assign_coach_email?: string;
  assign_coach_id?: string;
  session_limit?: number;
}

export type PreviewStatus = "valid" | "bad_email" | "invalid_role" | "duplicate_in_file" | "already_exists" | "coach_not_found";

export interface PreviewResult {
  row_index: number;
  email: string;
  status: PreviewStatus;
  message?: string;
}

export type SubmitStatus = "invited" | "failed" | "skipped";

export interface SubmitResult {
  row_index: number;
  row_id?: string;
  email: string;
  status: SubmitStatus;
  message?: string;
  created_user_id?: string;
}

export type BulkInviteBatch = Database["public"]["Tables"]["bulk_invite_batches"]["Row"];
export type BulkInviteRowRecord = Database["public"]["Tables"]["bulk_invite_rows"]["Row"];

/**
 * Owns the admin bulk-invite flow: dry-run preview, real submission (fresh batch or
 * resuming an existing one), and reading batch/row state back for the resume UI.
 */
export function useBulkInviteUsers() {
  const [busy, setBusy] = useState(false);

  const dryRun = useCallback(async (rows: BulkInviteRow[]): Promise<PreviewResult[]> => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-bulk-invite-users", {
        body: { dryRun: true, rows },
      });
      if (error) throw await extractFunctionError(error);
      return (data as { results: PreviewResult[] }).results;
    } finally {
      setBusy(false);
    }
  }, []);

  const submit = useCallback(
    async (rows: BulkInviteRow[], batchId?: string): Promise<{ batch_id: string; results: SubmitResult[] }> => {
      setBusy(true);
      try {
        const { data, error } = await supabase.functions.invoke("admin-bulk-invite-users", {
          body: { dryRun: false, batchId, rows },
        });
        if (error) throw await extractFunctionError(error);
        return data as { batch_id: string; results: SubmitResult[] };
      } finally {
        setBusy(false);
      }
    },
    []
  );

  const fetchBatchRows = useCallback(async (batchId: string): Promise<BulkInviteRowRecord[]> => {
    const { data, error } = await supabase
      .from("bulk_invite_rows")
      .select("*")
      .eq("batch_id", batchId)
      .order("row_index");
    if (error) throw error;
    return data ?? [];
  }, []);

  const fetchRecentBatches = useCallback(async (limit = 8): Promise<BulkInviteBatch[]> => {
    const { data, error } = await supabase
      .from("bulk_invite_batches")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data ?? [];
  }, []);

  return { busy, dryRun, submit, fetchBatchRows, fetchRecentBatches };
}
