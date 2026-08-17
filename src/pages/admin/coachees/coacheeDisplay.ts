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

export function programmeCompletionPct(startDate: string | null, durationMonths: number | null): number | null {
  if (!startDate || !durationMonths) return null;
  const start = new Date(startDate).getTime();
  const end = start + durationMonths * 30.4375 * 24 * 3600 * 1000;
  const now = Date.now();
  if (now <= start) return 0;
  if (now >= end) return 100;
  return Math.round(((now - start) / (end - start)) * 100);
}

export interface Row {
  id: string;
  full_name: string;
  email: string;
  status: Status;
  created_at: string;
  booked: number;
  done: number;
  programme_id: string | null;
  programme_name: string | null;
  programme_default_limit: number | null;
  programme_duration_months: number | null;
  cohort_id: string | null;
  cohort_name: string | null;
  organization_id: string | null;
  organization_name: string | null;
  enrollment_id: string | null;
  enrollment_start_date: string | null;
  selected_coaches: { id: string; name: string }[];
  session_limit: number;
  limit_row_id: string | null;
  access_request_id: string | null;
}

export async function exportCoacheesXlsx(rows: Row[], t: TFunction<"admin">): Promise<void> {
  const XLSX = await import("xlsx");
  const data = rows.map((c) => ({
    [t("coachees.export.name")]: c.full_name,
    [t("coachees.export.email")]: c.email,
    [t("coachees.export.registered")]: format(new Date(c.created_at), "yyyy-MM-dd"),
    [t("coachees.export.status")]: t(`coachees.statusLabels.${c.status}`),
    [t("coachees.export.bookedSessions")]: c.booked,
    [t("coachees.export.completedSessions")]: c.done,
    [t("coachees.export.sessionLimit")]: c.session_limit,
    [t("coachees.export.programme")]: c.programme_name || "",
    [t("coachees.export.cohort")]: c.cohort_name || "",
    [t("coachees.export.selectedCoaches")]: c.selected_coaches.map((s) => s.name).join("; "),
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, t("coachees.export.sheetName"));
  XLSX.writeFile(wb, `coachees-${format(new Date(), "yyyyMMdd")}.xlsx`);
}
