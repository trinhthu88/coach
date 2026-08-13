import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface UseSessionPrivateNotesOptions {
  sessionId: string | undefined;
  isPeer: boolean;
  coachId: string | undefined;
}

async function fetchPrivateNotes(privateTable: string, idCol: string, sessionId: string): Promise<string> {
  const { data: pn } = await supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from(privateTable as any)
    .select("body")
    .eq(idCol, sessionId)
    .maybeSingle();
  return (pn as unknown as { body: string | null } | null)?.body || "";
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

  const queryClient = useQueryClient();
  const queryKey = ["session-private-notes", privateTable, sessionId];

  const { data } = useQuery({
    queryKey,
    queryFn: () => fetchPrivateNotes(privateTable, idCol, sessionId as string),
    enabled: !!sessionId,
    staleTime: 30_000,
    // Locally editable before an explicit save; avoid a background
    // window-focus refetch silently overwriting unsaved notes.
    refetchOnWindowFocus: false,
  });

  // Locally editable (textarea) before an explicit save, seeded from the
  // loaded value whenever it changes.
  const [coachPrivate, setCoachPrivate] = useState("");
  useEffect(() => {
    setCoachPrivate(sessionId ? data ?? "" : "");
  }, [sessionId, data]);

  const reload = () => queryClient.invalidateQueries({ queryKey });

  const saveMutation = useMutation({
    mutationFn: async (payload: Record<string, string>) => {
      const { error } = await supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from(privateTable as any)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .upsert(payload as any, { onConflict: idCol });
      if (error) throw error;
    },
  });

  const save = async () => {
    if (!sessionId || !coachId) return { error: null };
    const payload = {
      [idCol]: sessionId,
      [coachIdCol]: coachId,
      body: coachPrivate,
    };
    try {
      await saveMutation.mutateAsync(payload);
      queryClient.invalidateQueries({ queryKey });
      return { error: null };
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed");
      return { error };
    }
  };

  return { coachPrivate, setCoachPrivate, reload, save };
}
