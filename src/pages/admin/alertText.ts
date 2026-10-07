import { format } from "date-fns";

/**
 * Admin alerts are computed on read by admin_alerts_current()
 * (20261006140000): what is true NOW, from canonical rows. Nothing is
 * scanned or derived here; this page only words each row. Rows of other
 * types that Edge Functions store in admin_alerts come through with their
 * stored id and can be resolved.
 */
export interface CurrentAlert {
  alert_key: string;
  stored_alert_id: string | null;
  severity: "info" | "warning" | "critical";
  alert_type: string;
  related_enrollment_id: string | null;
  related_user_id: string | null;
  related_coach_id: string | null;
  subject_name: string | null;
  subject_email: string | null;
  coach_name: string | null;
  count_value: number | null;
  pct_value: number | null;
  occurred_on: string | null;
  note: string | null;
  stored_title: string | null;
  stored_message: string | null;
  created_at: string | null;
}



/** The alert types admin_alerts_current() computes (everything else is a stored row). */
export const LIVE_ALERT_TYPES = new Set([
  "programme_at_risk",
  "needs_attention",
  "overdue_actions",
  "reflection_outstanding",
  "mentor_feedback_outstanding",
  "prep_file_outstanding",
  "stale_programme_participant",
  "low_quiz_scores",
  "goal_setup_overdue",
  "coach_flagged_session",
]);

/** The words for one alert row. Every number in it is the row's own. */
export function alertText(a: CurrentAlert, t: (key: string, opts?: Record<string, unknown>) => string) {
  if (a.stored_alert_id || !LIVE_ALERT_TYPES.has(a.alert_type)) {
    return { title: a.stored_title ?? a.alert_type, message: a.stored_message ?? "" };
  }
  const name = a.subject_name || t("alerts.someone");
  const params = {
    name,
    contact: a.subject_email ? ` (${a.subject_email})` : "",
    count: a.count_value ?? 0,
    pct: a.pct_value == null ? "—" : `${Math.round(Number(a.pct_value))}%`,
    date: a.occurred_on ? format(new Date(`${a.occurred_on}T00:00:00`), "d MMM yyyy") : "",
    coach: a.coach_name || t("alerts.aCoach"),
    note: a.note ?? "",
  };
  const base = `alerts.types.${a.alert_type}`;
  let message = t(`${base}.message`, params);
  if (a.alert_type === "needs_attention" && a.note === "behind" && !a.count_value) message = t(`${base}.messageBehind`, params);
  if (a.alert_type === "stale_programme_participant" && !a.occurred_on) message = t(`${base}.messageNever`, params);
  if (a.alert_type === "coach_flagged_session" && !a.note) message = t(`${base}.messageNoNote`, params);
  return { title: t(`${base}.title`, params), message };
}
