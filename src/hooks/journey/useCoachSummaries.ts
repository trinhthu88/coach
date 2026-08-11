import { useMemo } from "react";
import type { SessionSource } from "./types";

export interface CoachSummary {
  id: string;
  name: string;
  total: number;
  completed: number;
  upcoming: number;
  firstDate: Date | null;
  lastDate: Date | null;
  nextDate: Date | null;
  sources: Set<SessionSource>;
}

interface SummarySession {
  status: string;
  start_time: string;
  _source: SessionSource;
  _otherCoachId: string | null;
}

/**
 * Aggregates sessions into one summary row per "other party" (coach or
 * peer coach), used for the programme coach list. Shared between the
 * coachee and coach "my journey" views — how each summary is *rendered*
 * (badge wording, lead/specialist vs. coach/peer tags) stays page-specific.
 */
export function useCoachSummaries<S extends SummarySession>(
  sessions: S[],
  coachNames: Record<string, string>,
  now: Date,
  defaultName = "Coach"
) {
  return useMemo(() => {
    const map = new Map<string, CoachSummary>();
    for (const s of sessions) {
      const otherId = s._otherCoachId;
      if (!otherId) continue;
      const cur = map.get(otherId) || {
        id: otherId,
        name: coachNames[otherId] || (s._source === "peer" ? "Peer coach" : defaultName),
        total: 0,
        completed: 0,
        upcoming: 0,
        firstDate: null,
        lastDate: null,
        nextDate: null,
        sources: new Set<SessionSource>(),
      };
      const d = new Date(s.start_time);
      cur.total += 1;
      cur.sources.add(s._source);
      if (s.status === "completed") cur.completed += 1;
      if (["confirmed", "pending_coach_approval"].includes(s.status) && d >= now) {
        cur.upcoming += 1;
        if (!cur.nextDate || d < cur.nextDate) cur.nextDate = d;
      }
      if (!cur.firstDate || d < cur.firstDate) cur.firstDate = d;
      if (!cur.lastDate || d > cur.lastDate) cur.lastDate = d;
      cur.name = coachNames[otherId] || cur.name;
      map.set(otherId, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [sessions, coachNames, now, defaultName]);
}
