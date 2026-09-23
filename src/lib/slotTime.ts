/**
 * A coach availability slot is a wall-clock time in Vietnam: coach_availability
 * stores slot_date + start_time/end_time exactly as the coach types them.
 * Mirrors public.availability_slot_time_zone() (20261003100000), which the
 * booking functions use to read the same slot -- so the booking page and the
 * server agree whatever the browser's own time zone is.
 *
 * Vietnam has no daylight saving time, so its offset is fixed.
 */
export const SLOT_TIME_ZONE = "Asia/Ho_Chi_Minh";
const SLOT_UTC_OFFSET = "+07:00";

/** The instant a slot's wall-clock time ("yyyy-MM-dd", "HH:mm") stands for. */
export function slotInstant(dateKey: string, hhmm: string): Date {
  return new Date(`${dateKey}T${hhmm}:00${SLOT_UTC_OFFSET}`);
}
