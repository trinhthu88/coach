import { programmeInstant } from "../_shared/programmeTime.ts";

const HOUR_MS = 60 * 60 * 1000;

/**
 * A "YYYY-MM-DD|HH" availability bucket is a Vietnamese hour
 * (coachee_availability is entered in programme time): 09 is 09:00-10:00 in
 * Asia/Ho_Chi_Minh, i.e. 02:00-03:00 UTC.
 */
export function bucketToRange(bucket: string): { start: string; end: string } {
  const [date, hourStr] = bucket.split("|");
  const start = programmeInstant(date, Number(hourStr));
  const end = new Date(new Date(start).getTime() + HOUR_MS).toISOString();
  return { start, end };
}
