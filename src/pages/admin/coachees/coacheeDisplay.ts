import { format } from "date-fns";

export type Status = "pending_approval" | "active" | "rejected" | "suspended" | "reach_limit";

export const STATUS_LABEL: Record<Status, string> = {
  pending_approval: "Awaiting approval",
  active: "Active",
  rejected: "Rejected",
  suspended: "Suspended",
  reach_limit: "Reached limit",
};

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

export async function exportCoacheesXlsx(rows: Row[]): Promise<void> {
  const XLSX = await import("xlsx");
  const data = rows.map((c) => ({
    Name: c.full_name,
    Email: c.email,
    Registered: format(new Date(c.created_at), "yyyy-MM-dd"),
    Status: STATUS_LABEL[c.status],
    "Booked sessions": c.booked,
    "Completed sessions": c.done,
    "Session limit": c.session_limit,
    Programme: c.programme_name || "",
    Cohort: c.cohort_name || "",
    "Selected coaches": c.selected_coaches.map((s) => s.name).join("; "),
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Coachees");
  XLSX.writeFile(wb, `coachees-${format(new Date(), "yyyyMMdd")}.xlsx`);
}
