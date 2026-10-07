export type AdminSessionKind = "coaching" | "peer";
export type AdminSessionCoachField = "coach_id" | "peer_coach_id";

export type AdminSessionCalendarRow = {
  status: unknown;
  topic?: unknown;
  start_time?: unknown;
  duration_minutes?: unknown;
  meeting_url?: unknown;
  coach_id?: unknown;
  peer_coach_id?: unknown;
};

export type AdminCalendarEventInput = {
  coachId: string;
  source: AdminSessionKind;
  sessionId: string;
  topic: string | null;
  startTime: string;
  durationMinutes: number;
  meetingUrl: string | null;
};

export type AdminCalendarSyncState = "not_connected" | "synced" | "removed";

export function adminSessionCalendarColumns(coachField: AdminSessionCoachField): string {
  return [
    "id",
    "status",
    "topic",
    "start_time",
    "duration_minutes",
    "meeting_url",
    coachField,
  ].join(", ");
}

export async function syncAdminEditedCalendarSession(
  source: AdminSessionKind,
  sessionId: string,
  row: AdminSessionCalendarRow,
  actions: {
    syncEvent: (input: AdminCalendarEventInput) => Promise<{ connected: boolean; synced: boolean }>;
    removeEvent: (
      coachId: string,
      source: AdminSessionKind,
      sessionId: string,
    ) => Promise<{ connected: boolean; removed: boolean }>;
  },
): Promise<AdminCalendarSyncState> {
  const coachField = source === "peer" ? "peer_coach_id" : "coach_id";
  const coachId = row[coachField];
  if (typeof coachId !== "string" || !coachId) {
    throw new Error("The edited session has no coach assigned for Calendar sync");
  }

  if (row.status === "confirmed") {
    const result = await actions.syncEvent({
      coachId,
      source,
      sessionId,
      topic: typeof row.topic === "string" ? row.topic : null,
      startTime: String(row.start_time),
      durationMinutes: Number(row.duration_minutes) || 45,
      meetingUrl: typeof row.meeting_url === "string" ? row.meeting_url : null,
    });
    return result.connected && result.synced ? "synced" : "not_connected";
  }

  if (row.status !== "completed") {
    const result = await actions.removeEvent(coachId, source, sessionId);
    return result.connected && result.removed ? "removed" : "not_connected";
  }

  return "not_connected";
}
