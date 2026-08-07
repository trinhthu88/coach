import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface UseSessionPrivateNotesOptions {
  sessionId: string | undefined;
  isPeer: boolean;
  coachId: string | undefined;
}

/**
 * Manages the coach-only private notes for a session, stored in a dedicated
 * table so that RLS naturally hides them from the coachee.
 */
export function useSessionPrivateNotes({
  sessionId,
  isPeer,
  coachId,
}: UseSessionPrivateNotesOptions) {
  const privateTable = isPeer
    ? "peer_coach_session_private_notes"
    : "coach_session_private_notes";
  const idCol = isPeer ? "peer_session_id" : "session_id";
  const coachIdCol = isPeer ? "peer_coach_id" : "coach_id";

  const [coachPrivate, setCoachPrivate] = useState("");

  const load = useCallback(async () => {
    if (!sessionId) return;
    const { data: pn } = await supabase
      .from(privateTable)
      .select("body")
      .eq(idCol, sessionId)
      .maybeSingle();
    setCoachPrivate((pn as { body: string | null } | null)?.body || "");
  }, [sessionId, privateTable, idCol]);

  useEffect(() => {
    load();
  }, [load]);

  const save = useCallback(async () => {
    if (!sessionId || !coachId) return { error: null };
    const payload = {
      [idCol]: sessionId,
      [coachIdCol]: coachId,
      body: coachPrivate,
    };
    const { error } = await supabase
      .from(privateTable)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .upsert(payload as any, { onConflict: idCol });
    if (error) toast.error(error.message);
    return { error };
  }, [sessionId, coachId, coachPrivate, privateTable, idCol, coachIdCol]);

  return { coachPrivate, setCoachPrivate, reload: load, save };
}
