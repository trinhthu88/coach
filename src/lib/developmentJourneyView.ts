import { format } from "date-fns";
import type { DevelopmentJourneyEvent, DevelopmentJourneyEventType } from "@/hooks/journey/developmentJourneyTypes";

/**
 * Presentation-only grouping of the canonical Development Journey events
 * (useEnrollmentDevelopmentJourney) into the Coachee prototype's filter
 * chips → month buckets → rows. Nothing here adds, drops or re-derives an
 * event: every row is one event, or a same-day run of same-kind events shown
 * collapsed ("3 items") with each original title inside.
 */
export type JourneyFilter = "all" | "goals" | "sessions" | "training" | "reflections";

export const JOURNEY_FILTERS: JourneyFilter[] = ["all", "goals", "sessions", "training", "reflections"];

const FILTER_BY_TYPE: Record<DevelopmentJourneyEventType, Exclude<JourneyFilter, "all">> = {
  goal: "goals",
  action: "goals",
  coaching: "sessions",
  peer_coaching: "sessions",
  mentoring: "sessions",
  triad: "sessions",
  feedback: "sessions",
  training: "training",
  reflection: "reflections",
};

export function journeyFilterOf(type: DevelopmentJourneyEventType): Exclude<JourneyFilter, "all"> {
  return FILTER_BY_TYPE[type];
}

export interface JourneyRow {
  key: string;
  day: string;
  type: DevelopmentJourneyEventType;
  events: DevelopmentJourneyEvent[];
}

export interface JourneyMonth {
  key: string;
  occurredAt: string;
  rows: JourneyRow[];
  eventCount: number;
}

/** Minimum same-day, same-kind run that collapses into one grouped row. */
const GROUP_MIN = 3;

// Local-time keys, so buckets agree with the displayed "d MMM" / "MMMM yyyy" labels.
function dayKey(iso: string) {
  return format(new Date(iso), "yyyy-MM-dd");
}

function monthKey(iso: string) {
  return format(new Date(iso), "yyyy-MM");
}

export function filterJourneyEvents(events: DevelopmentJourneyEvent[], filter: JourneyFilter) {
  return filter === "all" ? events : events.filter((e) => FILTER_BY_TYPE[e.type] === filter);
}

export function countByFilter(events: DevelopmentJourneyEvent[]): Record<JourneyFilter, number> {
  const counts: Record<JourneyFilter, number> = { all: events.length, goals: 0, sessions: 0, training: 0, reflections: 0 };
  for (const e of events) counts[FILTER_BY_TYPE[e.type]] += 1;
  return counts;
}

/** Newest first; month buckets; consecutive same-day same-type/subtype runs of ≥3 collapse into one row. */
export function groupJourneyByMonth(events: DevelopmentJourneyEvent[]): JourneyMonth[] {
  const sorted = [...events].sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
  const months: JourneyMonth[] = [];
  for (const event of sorted) {
    const mk = monthKey(event.occurredAt);
    let month = months[months.length - 1];
    if (!month || month.key !== mk) {
      month = { key: mk, occurredAt: event.occurredAt, rows: [], eventCount: 0 };
      months.push(month);
    }
    month.eventCount += 1;
    const last = month.rows[month.rows.length - 1];
    if (last && last.day === dayKey(event.occurredAt) && last.type === event.type && last.events[0].subtype === event.subtype) {
      last.events.push(event);
    } else {
      month.rows.push({ key: event.id, day: dayKey(event.occurredAt), type: event.type, events: [event] });
    }
  }
  // Runs shorter than GROUP_MIN are shown as individual rows again.
  for (const month of months) {
    month.rows = month.rows.flatMap((row) =>
      row.events.length >= GROUP_MIN ? [row] : row.events.map((e) => ({ key: e.id, day: row.day, type: row.type, events: [e] }))
    );
  }
  return months;
}
