/**
 * The programme runs in one time zone, Asia/Ho_Chi_Minh (decision 2). Mirrors
 * public.programme_time_zone() / public.programme_today() (20261006150000):
 * an Edge Function's "today", and the day boundaries it queries by, are
 * Vietnamese days, never UTC ones. Vietnam has no daylight saving time.
 */
export const PROGRAMME_TIME_ZONE = "Asia/Ho_Chi_Minh";
const PROGRAMME_UTC_OFFSET = "+07:00";
const DAY_MS = 24 * 60 * 60 * 1000;

/** "yyyy-MM-dd" of today in Vietnam, shifted by whole days. */
export function programmeToday(offsetDays = 0, now: Date = new Date()): string {
  // en-CA formats as yyyy-MM-dd.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: PROGRAMME_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now.getTime() + offsetDays * DAY_MS));
}

/** The instant a Vietnamese day starts, for timestamp range queries. */
export function programmeDayStart(dateKey: string): string {
  return `${dateKey}T00:00:00${PROGRAMME_UTC_OFFSET}`;
}

/**
 * The instant a Vietnamese wall-clock time happens, as an ISO string. A time
 * a learner entered in Vietnam (availability, a slot) is never read as UTC.
 */
export function programmeInstant(dateKey: string, hour: number, minute = 0): string {
  const hh = String(hour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");
  return new Date(`${dateKey}T${hh}:${mm}:00${PROGRAMME_UTC_OFFSET}`).toISOString();
}

const programmeDateTimeFormat = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: PROGRAMME_TIME_ZONE,
});

/** An instant as people in the programme read it: "Thu, Oct 15, 2026, 6:30 AM (Vietnam time)". */
export function formatProgrammeDateTime(instantISO: string): string {
  return `${programmeDateTimeFormat.format(new Date(instantISO))} (Vietnam time)`;
}

/** A session's start and length for an email: "Thu, Oct 15, 2026, 6:30 AM (Vietnam time) · 60 min". */
export function formatSessionWhen(startTimeISO: string, durationMinutes: number): string {
  return `${formatProgrammeDateTime(startTimeISO)} · ${durationMinutes} min`;
}
