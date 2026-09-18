import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  changedRequirementItems,
  diffRequirementSchedules,
  toSavePayload,
  type CohortRequirementItem,
  type CohortScheduleChange,
} from "@/lib/cohortSchedule";

export interface CohortScheduleIssue {
  programme_id: string;
  module: string;
  issue: string;
  required_units: number | null;
  scheduled_units: number;
}

interface Params {
  open: boolean;
  cohortId: string | null | undefined;
  programmeId: string | null | undefined;
  start: string | null | undefined;
  end: string | null | undefined;
}

/**
 * Admin cohort requirement schedule.
 *  - New cohort: shows the programme policy's PROPOSED dates
 *    (cohort_requirement_schedule_proposal) and lets the Admin edit them
 *    before they are saved as the cohort's canonical dates.
 *  - Existing cohort: shows the SAVED canonical dates
 *    (cohort_requirement_dates). Editing a date changes only that unit.
 *    Changing cohort start/end never rewrites them; "Regenerate schedule"
 *    fetches a proposal, shows the per-unit changes for review, and is only
 *    saved when the Admin confirms.
 * No date is calculated in the browser.
 */
export function useCohortRequirementSchedule({ open, cohortId, programmeId, start, end }: Params) {
  const isNew = !cohortId;
  const [items, setItems] = useState<CohortRequirementItem[]>([]);
  const [baseline, setBaseline] = useState<CohortRequirementItem[]>([]);
  const [issues, setIssues] = useState<CohortScheduleIssue[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [regenerated, setRegenerated] = useState(false);
  const [review, setReview] = useState<{ proposal: CohortRequirementItem[]; changes: CohortScheduleChange[] } | null>(null);

  const fetchProposal = useCallback(async (): Promise<CohortRequirementItem[]> => {
    if (!programmeId || !start || !end) return [];
    const { data, error: rpcError } = await supabase.rpc("cohort_requirement_schedule_proposal", {
      p_programme_id: programmeId,
      p_start: start,
      p_end: end,
      ...(cohortId ? { p_cohort_id: cohortId } : {}),
    });
    if (rpcError) throw rpcError;
    return (data ?? []).map((row) => ({
      programme_id: row.programme_id,
      module: row.module,
      ordinal: row.ordinal,
      due_on: row.due_on,
      units: row.units,
      generation_method: row.generation_method,
    }));
  }, [programmeId, start, end, cohortId]);

  const loadSaved = useCallback(async () => {
    if (!cohortId) return;
    setLoading(true);
    setError(null);
    const [rows, health] = await Promise.all([
      supabase
        .from("cohort_requirement_dates")
        .select("programme_id, module, ordinal, due_on, units, generation_method, generated_due_on, is_overridden")
        .eq("cohort_id", cohortId)
        .order("module")
        .order("ordinal"),
      supabase.rpc("cohort_requirement_schedule_issues", { p_cohort_id: cohortId }),
    ]);
    if (rows.error || health.error) {
      setError((rows.error ?? health.error)?.message ?? "error");
      setLoading(false);
      return;
    }
    const saved = (rows.data ?? []) as CohortRequirementItem[];
    setItems(saved);
    setBaseline(saved);
    setIssues((health.data ?? []) as CohortScheduleIssue[]);
    setRegenerated(false);
    setReview(null);
    setLoading(false);
  }, [cohortId]);

  // Existing cohort: saved dates (never re-derived when start/end change in the form).
  useEffect(() => {
    if (open && cohortId) void loadSaved();
  }, [open, cohortId, loadSaved]);

  // New cohort: proposal follows the chosen programme / dates until saved.
  useEffect(() => {
    if (!open || !isNew) return;
    let cancelled = false;
    setError(null);
    if (!programmeId || !start || !end) {
      setItems([]);
      setBaseline([]);
      return;
    }
    setLoading(true);
    fetchProposal()
      .then((proposal) => {
        if (cancelled) return;
        setItems(proposal);
        setBaseline(proposal);
      })
      .catch((e: { message?: string }) => !cancelled && setError(e?.message ?? "error"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, isNew, programmeId, start, end, fetchProposal]);

  const setDate = (key: { programme_id: string; module: string; ordinal: number }, due_on: string) =>
    setItems((prev) =>
      prev.map((i) =>
        i.programme_id === key.programme_id && i.module === key.module && i.ordinal === key.ordinal ? { ...i, due_on } : i
      )
    );

  /** Step 1 of "Regenerate schedule": fetch the proposal and show what would change. */
  const startRegenerate = async () => {
    setError(null);
    try {
      const proposal = await fetchProposal();
      setReview({ proposal, changes: diffRequirementSchedules(items, proposal) });
    } catch (e) {
      setError((e as { message?: string })?.message ?? "error");
    }
  };
  /** Step 2: the Admin accepted the reviewed proposal (still unsaved until Save). */
  const acceptRegenerate = () => {
    if (!review) return;
    setItems(review.proposal);
    setRegenerated(true);
    setReview(null);
  };
  const cancelRegenerate = () => setReview(null);

  const changed = changedRequirementItems(baseline, items);
  const dirty = regenerated || changed.length > 0;

  /** Persist to the canonical cohort schedule. Returns the number of saved units. */
  const save = async (targetCohortId: string) => {
    if (regenerated) {
      const { data, error: rpcError } = await supabase.rpc("admin_save_cohort_requirement_dates", {
        p_cohort_id: targetCohortId,
        p_items: toSavePayload(items),
        p_regenerate: true,
      });
      if (rpcError) throw rpcError;
      return data ?? 0;
    }
    if (changed.length === 0) return 0;
    const { data, error: rpcError } = await supabase.rpc("admin_save_cohort_requirement_dates", {
      p_cohort_id: targetCohortId,
      p_items: toSavePayload(changed),
    });
    if (rpcError) throw rpcError;
    return data ?? 0;
  };

  return {
    isNew,
    items,
    baseline,
    issues,
    loading,
    error,
    dirty,
    changedKeys: new Set(changed.map((i) => `${i.programme_id}:${i.module}:${i.ordinal}`)),
    regenerated,
    review,
    setDate,
    startRegenerate,
    acceptRegenerate,
    cancelRegenerate,
    save,
    reload: loadSaved,
  };
}

export type CohortRequirementScheduleState = ReturnType<typeof useCohortRequirementSchedule>;
