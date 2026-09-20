import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  changedModuleDeadlines,
  sortModuleDeadlines,
  toDeadlinePayload,
  type CohortModuleDeadline,
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
 * Admin cohort requirement deadlines.
 *
 * One date per module: by when this cohort must have completed it. The
 * required unit COUNT belongs to the programme, and the canonical requirement
 * rows are materialised by the database from the two together. There is
 * nothing per-unit to edit and nothing to "regenerate".
 *
 *  - New cohort: the proposal offers the cohort end date being entered.
 *  - Existing cohort: the saved deadlines, with the units actually materialised
 *    against each, so a mismatch is visible rather than inferred.
 */
export function useCohortRequirementSchedule({ open, cohortId, programmeId, start, end }: Params) {
  const isNew = !cohortId;
  const [items, setItems] = useState<CohortModuleDeadline[]>([]);
  const [baseline, setBaseline] = useState<CohortModuleDeadline[]>([]);
  const [issues, setIssues] = useState<CohortScheduleIssue[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSaved = useCallback(async () => {
    if (!cohortId) return;
    setLoading(true);
    setError(null);
    const [rows, health] = await Promise.all([
      supabase.rpc("admin_cohort_module_deadlines", { p_cohort_id: cohortId }),
      supabase.rpc("cohort_requirement_schedule_issues", { p_cohort_id: cohortId }),
    ]);
    if (rows.error || health.error) {
      setError((rows.error ?? health.error)?.message ?? "error");
      setLoading(false);
      return;
    }
    const saved = sortModuleDeadlines((rows.data ?? []) as CohortModuleDeadline[]);
    setItems(saved);
    setBaseline(saved);
    setIssues((health.data ?? []) as CohortScheduleIssue[]);
    setLoading(false);
  }, [cohortId]);

  // Existing cohort: the saved deadlines. Editing start/end in the form never
  // re-derives them; only saving the cohort moves a deadline the system set.
  useEffect(() => {
    if (open && cohortId) void loadSaved();
  }, [open, cohortId, loadSaved]);

  // New cohort: the proposal follows the chosen programme and end date.
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
    supabase
      .rpc("cohort_module_deadline_proposal", { p_programme_id: programmeId, p_end: end })
      .then(({ data, error: rpcError }) => {
        if (cancelled) return;
        if (rpcError) {
          setError(rpcError.message);
        } else {
          const proposal = sortModuleDeadlines(
            (data ?? []).map((row) => ({
              programme_id: row.programme_id,
              module: row.module,
              required_units: row.required_units,
              scheduled_units: row.required_units,
              completion_deadline: row.completion_deadline,
              source: "cohort_end",
            })),
          );
          setItems(proposal);
          setBaseline(proposal);
        }
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, isNew, programmeId, start, end]);

  const setDeadline = (key: { programme_id: string; module: string }, completion_deadline: string) =>
    setItems((prev) =>
      prev.map((i) =>
        i.programme_id === key.programme_id && i.module === key.module ? { ...i, completion_deadline } : i,
      ),
    );

  const changed = changedModuleDeadlines(baseline, items);
  const dirty = changed.length > 0;

  /** Persist to the canonical cohort deadlines. Returns the number of modules saved. */
  const save = async (targetCohortId: string) => {
    if (changed.length === 0) return 0;
    const { data, error: rpcError } = await supabase.rpc("admin_set_cohort_module_deadlines", {
      p_cohort_id: targetCohortId,
      p_items: toDeadlinePayload(changed),
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
    changedKeys: new Set(changed.map((i) => `${i.programme_id}:${i.module}`)),
    setDeadline,
    save,
    reload: loadSaved,
  };
}

export type CohortRequirementScheduleState = ReturnType<typeof useCohortRequirementSchedule>;
