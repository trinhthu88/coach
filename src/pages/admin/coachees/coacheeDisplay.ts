import { format } from "date-fns";
import type { TFunction } from "i18next";

export type Status = "pending_approval" | "active" | "rejected" | "suspended" | "reach_limit";

export const STATUS_KEYS: Status[] = ["pending_approval", "active", "rejected", "suspended", "reach_limit"];

export const STATUS_TONE: Record<Status, "muted" | "success" | "warning" | "destructive"> = {
  pending_approval: "warning",
  active: "success",
  rejected: "destructive",
  suspended: "destructive",
  reach_limit: "warning",
};

export interface Row {
  id: string;
  full_name: string;
  email: string;
  status: Status;
  created_at: string;
  /** Canonical booked-but-not-held requirement units on the current enrollment (booked_units). */
  booked: number;
  /** Canonical required activities completed / required on the CURRENT enrollment — never a lifetime count. */
  completed_units: number | null;
  required_units: number | null;
  /** The canonical progress read failed: show an error state, never a silent zero. */
  progress_error: boolean;
  programme_id: string | null;
  programme_name: string | null;
  programme_duration_months: number | null;
  cohort_id: string | null;
  cohort_name: string | null;
  organization_id: string | null;
  organization_name: string | null;
  enrollment_id: string | null;
  enrollment_start_date: string | null;
  /** Effective enrollment status of the current enrollment (canonical), null without an enrollment. */
  enrollment_status?: string | null;
  /** canonicalCompletionPct of the selected enrollment; null when canonical progress is unavailable. */
  completion_pct: number | null;
  selected_coaches: { id: string; name: string }[];
  access_request_id: string | null;
  spoken_languages: string[];
}

export async function exportCoacheesXlsx(rows: Row[], t: TFunction<"admin">): Promise<void> {
  const XLSX = await import("xlsx");
  const data = rows.map((c) => ({
    [t("coachees.export.name")]: c.full_name,
    [t("coachees.export.email")]: c.email,
    [t("coachees.export.registered")]: format(new Date(c.created_at), "yyyy-MM-dd"),
    [t("coachees.export.status")]: t(`coachees.statusLabels.${c.status}`),
    [t("coachees.export.bookedSessions")]: c.booked,
    [t("coachees.export.completedUnits")]: c.required_units == null ? "" : `${c.completed_units}/${c.required_units}`,
    [t("coachees.export.programme")]: c.programme_name || "",
    [t("coachees.export.cohort")]: c.cohort_name || "",
    [t("coachees.export.organisation")]: c.organization_name || "",
    [t("coachees.export.selectedCoaches")]: c.selected_coaches.map((s) => s.name).join("; "),
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, t("coachees.export.sheetName"));
  XLSX.writeFile(wb, `coachees-${format(new Date(), "yyyyMMdd")}.xlsx`);
}
