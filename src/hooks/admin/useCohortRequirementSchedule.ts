import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  changedModuleDeadlines,
  sortModuleDeadlines,
  toDeadlinePayload,
  toRequirementDatePayload,
  type CohortModuleDeadline,
  type CohortRequirementDate,
  type RequirementDateEdit,
} from "@/lib/cohortSchedule";

export interface CohortScheduleIssue {
  programme_id: string;
  module: string;
  issue: string;
  required_units: number | null;
  scheduled_units: number;
}

/** A requirement-integrity finding for this cohort (admin_requirement_integrity_issues). */
export interface CohortIntegrityIssue {
  issue: string;
  programme_id: string | null;
  module: string | null;
  detail: string;
}

interface Params {
  open: boolean;
  cohortId: string | null | undefined;
  programmeId: string | null | undefined;
  start: string | null | undefined;
  end: string | null | undefined;
}

/**
 * Admin cohort requirement dates.
 *
 * The programme says how many units each module requires (N); the cohort holds
 * exactly N requirement rows per module -- one per selected week for Training --
 * and each row has its OWN date. Per session module there is also a default
 * completion deadline: new rows start at it, and every row an Admin has not
 * dated individually follows it ("apply to all" = reset every row to it).
 *
 *  - New cohort: the proposal offers the cohort end date as each module
 *    default; the individual rows exist once the cohort is saved.
 *  - Existing cohort: the saved defaults AND every requirement row with its
 *    date, so a count mismatch is visible rather than inferred.
 */
export function useCohortRequirementSchedule({ open, cohortId, programmeId, start, end }: Params) {
  const isNew = !cohortId;
  const [items, setItems] = useState<CohortModuleDeadline[]>([]);
  const [baseline, setBaseline] = useState<CohortModuleDeadline[]>([]);
  const [issues, setIssues] = useState<CohortScheduleIssue[]>([]);
  const [integrity, setIntegrity] = useState<CohortIntegrityIssue[]>([]);
  const [requirements, setRequirements] = useState<CohortRequirementDate[]>([]);
  const [requirementEdits, setRequirementEdits] = useState<Record<string, RequirementDateEdit>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSaved = useCallback(async () => {
    if (!cohortId) return;
    setLoading(true);
    setError(null);
    const [rows, health, reqs, checks] = await Promise.all([
      supabase.rpc("admin_cohort_module_deadlines", { p_cohort_id: cohortId }),
      supabase.rpc("cohort_requirement_schedule_issues", { p_cohort_id: cohortId }),
      supabase.rpc("admin_cohort_requirement_schedule", { p_cohort_id: cohortId }),
      supabase.rpc("admin_requirement_integrity_issues"),
    ]);
    if (rows.error || health.error || reqs.error) {
      setError((rows.error ?? health.error ?? reqs.error)?.message ?? "error");
      setLoading(false);
      return;
    }
    const saved = sortModuleDeadlines((rows.data ?? []) as CohortModuleDeadline[]);
    setItems(saved);
    setBaseline(saved);
    setIssues((health.data ?? []) as CohortScheduleIssue[]);
    setRequirements((reqs.data ?? []) as CohortRequirementDate[]);
    setRequirementEdits({});
    // Integrity findings are informational: a failure to load them never
    // blocks editing dates.
    setIntegrity(
      ((checks.data ?? []) as (CohortIntegrityIssue & { cohort_id: string | null })[])
        .filter((i) => i.cohort_id === cohortId && !i.issue.startsWith("schedule:missing_deadline")),
    );
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
    setRequirements([]);
    setRequirementEdits({});
    setIntegrity([]);
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

  /** Give one requirement its own date. */
  const setRequirementDate = (requirementId: string, date: string) =>
    setRequirementEdits((prev) => ({ ...prev, [requirementId]: date }));

  /** Return one requirement to its default (module deadline / week pacing). */
  const resetRequirement = (requirementId: string) =>
    setRequirementEdits((prev) => ({ ...prev, [requirementId]: null }));

  /** "Apply the module deadline to all requirements": every row follows the default again. */
  const applyDefaultToModule = (key: { programme_id: string; module: string }) =>
    setRequirementEdits((prev) => {
      const next = { ...prev };
      for (const r of requirements) {
        if (r.programme_id === key.programme_id && r.module === key.module) next[r.requirement_id] = null;
      }
      return next;
    });

  const changed = changedModuleDeadlines(baseline, items);
  const requirementChanges = toRequirementDatePayload(requirements, requirementEdits);
  const dirty = changed.length > 0 || requirementChanges.length > 0;

  /**
   * Persist: module defaults first (rows that follow them move), then the
   * individual requirement dates. Returns the number of rows saved.
   */
  const save = async (targetCohortId: string) => {
    let saved = 0;
    if (changed.length > 0) {
      const { data, error: rpcError } = await supabase.rpc("admin_set_cohort_module_deadlines", {
        p_cohort_id: targetCohortId,
        p_items: toDeadlinePayload(changed),
      });
      if (rpcError) throw rpcError;
      saved += data ?? 0;
    }
    if (requirementChanges.length > 0) {
      const { data, error: rpcError } = await supabase.rpc("admin_set_cohort_requirement_dates", {
        p_cohort_id: targetCohortId,
        p_items: requirementChanges,
      });
      if (rpcError) throw rpcError;
      saved += data ?? 0;
    }
    return saved;
  };

  return {
    isNew,
    items,
    baseline,
    issues,
    integrity,
    requirements,
    requirementEdits,
    loading,
    error,
    dirty,
    changedKeys: new Set(changed.map((i) => `${i.programme_id}:${i.module}`)),
    setDeadline,
    setRequirementDate,
    resetRequirement,
    applyDefaultToModule,
    save,
    reload: loadSaved,
  };
}

export type CohortRequirementScheduleState = ReturnType<typeof useCohortRequirementSchedule>;
