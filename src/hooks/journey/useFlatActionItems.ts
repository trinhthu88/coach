import { useMemo } from "react";
import { endOfWeek, isAfter, isBefore } from "date-fns";
import type { Json } from "@/integrations/supabase/types";
import type { RawActionItem, SessionSource } from "./types";

export interface FlatAction extends RawActionItem {
  sessionId: string;
  sessionTopic: string;
  sessionDate: string;
  idx: number;
  source: SessionSource;
}

export interface GroupedActions {
  overdue: FlatAction[];
  thisWeek: FlatAction[];
  upcoming: FlatAction[];
  completed: FlatAction[];
}

interface ActionSession {
  id: string;
  topic: string;
  start_time: string;
  action_items: Json;
  _source?: SessionSource;
}

/**
 * Flattens each session's `action_items` JSON blob into a single list
 * (tagged with the owning session), plus overdue/this-week/upcoming/
 * completed groupings. Shared between the coachee and coach "my journey"
 * views — neither `allActionItems` nor `grouped` is memoized against a
 * `now` timestamp, matching the pre-extraction behavior of recomputing on
 * every render.
 */
export function useFlatActionItems<S extends ActionSession>(sessions: S[]) {
  const allActionItems: FlatAction[] = useMemo(() => {
    const out: FlatAction[] = [];
    for (const s of sessions) {
      const items = Array.isArray(s.action_items) ? s.action_items : [];
      items.forEach((it: Json, idx: number) => {
        const obj: RawActionItem =
          typeof it === "string" ? { text: it, done: false } : (it as unknown as RawActionItem);
        if (obj?.text) {
          out.push({
            ...obj,
            sessionId: s.id,
            sessionTopic: s.topic,
            sessionDate: s.start_time,
            idx,
            source: s._source ?? "coaching",
          });
        }
      });
    }
    return out;
  }, [sessions]);

  const aiTotal = allActionItems.length;
  const aiDone = allActionItems.filter((a) => a.done).length;
  const aiOverdue = allActionItems.filter(
    (a) => !a.done && a.due_date && isBefore(new Date(a.due_date), new Date())
  ).length;

  const now = new Date();
  const wkEnd = endOfWeek(now, { weekStartsOn: 1 });
  const grouped: GroupedActions = {
    overdue: allActionItems.filter((a) => !a.done && a.due_date && isBefore(new Date(a.due_date), now)),
    thisWeek: allActionItems.filter(
      (a) => !a.done && a.due_date && !isBefore(new Date(a.due_date), now) && !isAfter(new Date(a.due_date), wkEnd)
    ),
    upcoming: allActionItems.filter((a) => !a.done && (!a.due_date || isAfter(new Date(a.due_date), wkEnd))),
    completed: allActionItems.filter((a) => a.done),
  };

  return { allActionItems, grouped, aiTotal, aiDone, aiOverdue };
}
