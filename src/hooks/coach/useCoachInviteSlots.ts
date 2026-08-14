import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const DEFAULT_INVITE_LIMIT = 3;

export interface InviteFormValues {
  email: string;
  full_name: string;
  session_limit?: number;
}

type InviteResult =
  | { ok: true }
  | { ok: false; error: "invite_limit_reached"; limit: number; current: number }
  | { ok: false; error: "email_already_registered" }
  | { ok: false; error: "other"; message: string };

/**
 * Owns the coach-invite-coachee slot cap (used/limit), the invite call, and the
 * remove-client call. Slot usage is read via get_own_coach_invite_slots() rather than
 * a direct table query: coachee_profiles RLS only lets a coach see coachees who've
 * actually booked a session, so a freshly-invited-but-unbooked coachee would be
 * invisible to a client-side count.
 */
export function useCoachInviteSlots(coachId: string | undefined) {
  const [used, setUsed] = useState(0);
  const [limit, setLimit] = useState(DEFAULT_INVITE_LIMIT);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!coachId) return;
    setLoading(true);
    const { data, error } = await supabase.rpc("get_own_coach_invite_slots").maybeSingle();
    if (!error && data) {
      setUsed(data.used_slots);
      setLimit(data.invite_limit);
    }
    setLoading(false);
  }, [coachId]);

  useEffect(() => {
    load();
  }, [load]);

  const invite = useCallback(
    async (values: InviteFormValues): Promise<InviteResult> => {
      const { data, error } = await supabase.functions.invoke("coach-invite-coachee", {
        body: {
          email: values.email.trim(),
          full_name: values.full_name.trim(),
          session_limit: values.session_limit,
        },
      });

      if (!error) {
        const result = data as { ok?: boolean } | null;
        if (result?.ok) {
          await load();
          return { ok: true };
        }
        return { ok: false, error: "other", message: "Could not invite client" };
      }

      // On a non-2xx response, supabase-js's `data` is null — the structured JSON body
      // this function returns (invite_limit_reached / email_already_registered) only
      // lives on `error.context`, the raw underlying Response.
      const context = (error as { context?: Response }).context;
      const body = context && typeof context.json === "function"
        ? await context.json().catch(() => null) as { error?: string; limit?: number; current?: number } | null
        : null;

      if (body?.error === "invite_limit_reached") {
        return { ok: false, error: "invite_limit_reached", limit: body.limit!, current: body.current! };
      }
      if (body?.error === "email_already_registered") {
        return { ok: false, error: "email_already_registered" };
      }
      return { ok: false, error: "other", message: body?.error || error.message || "Could not invite client" };
    },
    [load]
  );

  const removeClient = useCallback(
    async (coacheeId: string) => {
      const { data, error } = await supabase.rpc("remove_own_coachee", { _coachee_id: coacheeId });
      if (error) {
        toast.error(error.message);
        return false;
      }
      if (!data) {
        toast.error("Client was already removed");
        return false;
      }
      toast.success("Client removed");
      await load();
      return true;
    },
    [load]
  );

  return { used, limit, loading, reload: load, invite, removeClient };
}
