import { supabase } from "@/integrations/supabase/client";

export interface CoachCalendarBusyInterval {
  start: number;
  end: number;
}

export async function getCoachCalendarBusy(
  coachId: string,
  timeMin: string,
  timeMax: string,
): Promise<{ busy: CoachCalendarBusyInterval[] }> {
  const { data, error } = await supabase.functions.invoke("google-calendar-busy", {
    body: { coach_id: coachId, time_min: timeMin, time_max: timeMax },
  });
  if (error) throw error;
  if (!data || !Array.isArray(data.busy)) {
    throw new Error("Coach calendar availability response was invalid");
  }
  const busy = data.busy
    .filter((interval: { start?: unknown; end?: unknown }) =>
      typeof interval.start === "string" && typeof interval.end === "string",
    )
    .map((interval: { start: string; end: string }) => ({
      start: new Date(interval.start).getTime(),
      end: new Date(interval.end).getTime(),
    }))
    .filter((interval: CoachCalendarBusyInterval) =>
      Number.isFinite(interval.start) && Number.isFinite(interval.end) && interval.start < interval.end,
    );
  return { busy };
}

export async function getCoachCalendarBusyFailOpen(
  coachId: string,
  timeMin: string,
  timeMax: string,
  onError: (error: unknown) => void = () => {},
): Promise<{ busy: CoachCalendarBusyInterval[]; failed: boolean }> {
  try {
    const result = await getCoachCalendarBusy(coachId, timeMin, timeMax);
    return { busy: result.busy, failed: false };
  } catch (error) {
    onError(error);
    return { busy: [], failed: true };
  }
}

export function overlapsCalendarBusy(
  startTime: string,
  durationMinutes: number,
  busy: CoachCalendarBusyInterval[],
): boolean {
  const start = new Date(startTime).getTime();
  const end = start + durationMinutes * 60_000;
  return busy.some((interval) => interval.start < end && interval.end > start);
}
