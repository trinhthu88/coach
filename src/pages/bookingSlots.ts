/**
 * Pure slot-availability computation for the booking calendar in
 * BookSession.tsx — generates candidate start times (15-minute steps) for a
 * selected day's coach-availability windows, filtered to those that fit the
 * chosen session duration and don't overlap the booker's own existing
 * commitments (`busy`, e.g. their other upcoming sessions/peer-sessions).
 */

export interface DaySlot {
  id: string;
  slot_date: string;
  start_time: string;
  end_time: string;
}

export interface BusyInterval {
  start: number;
  end: number;
}

export function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export function minutesToTime(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function computeStartOptions(opts: {
  dateKey: string;
  slots: DaySlot[];
  durationMinutes: number;
  busy: BusyInterval[];
}): { start: string; slotId: string }[] {
  const { dateKey, slots, durationMinutes, busy } = opts;
  const daySlots = slots.filter((s) => s.slot_date === dateKey);
  const result: { start: string; slotId: string }[] = [];
  for (const s of daySlots) {
    const startMin = timeToMinutes(s.start_time);
    const endMin = timeToMinutes(s.end_time);
    for (let m = startMin; m + durationMinutes <= endMin; m += 15) {
      const startISO = new Date(`${dateKey}T${minutesToTime(m)}:00`).getTime();
      const endISO = startISO + durationMinutes * 60_000;
      const conflicts = busy.some((b) => startISO < b.end && endISO > b.start);
      if (!conflicts) result.push({ start: minutesToTime(m), slotId: s.id });
    }
  }
  return result;
}
