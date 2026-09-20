import { useMemo } from "react";
import { bucketByDueDate } from "@/lib/actionScheduling";
import type { RawActionItem, SessionSource } from "./types";
import type { EnrollmentActionItem } from "@/lib/enrollmentActions";

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
  enrollment_actions: EnrollmentActionItem[];
  _source?: SessionSource;
}

/**
 * Flattens the normalized action projection attached by withEnrollmentActions
 * at the display boundary. This hook never reads the persisted session JSON.
 */
export function useFlatActionItems<S extends ActionSession>(sessions: S[]) {
  const allActionItems: FlatAction[] = useMemo(() => {
    const out: FlatAction[] = [];
    for (const s of sessions) {
      const items = s.enrollment_actions;
      items.forEach((obj: EnrollmentActionItem, idx: number) => {
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

  const openItems = allActionItems.filter((a) => !a.done);
  const { overdue, thisWeek, upcoming } = bucketByDueDate(openItems, (a) => a.due_date);
  const grouped: GroupedActions = {
    overdue,
    thisWeek,
    upcoming,
    completed: allActionItems.filter((a) => a.done),
  };

  return { allActionItems, grouped, aiTotal, aiDone, aiOverdue: overdue.length };
}
