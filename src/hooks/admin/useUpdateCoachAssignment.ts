import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

/**
 * Saves a coach's coach-as-coachee session limits and its allowlist of
 * assignable coaches.
 */
export function useUpdateCoachAssignment() {
  const [saving, setSaving] = useState(false);

  const save = async (
    coach: { id: string; limit_row_id: string | null },
    coachLimit: number,
    peerLimit: number,
    pickedCoachIds: Set<string>
  ) => {
    setSaving(true);
    try {
      // Upsert coach session limits (treated as totals)
      if (coach.limit_row_id) {
        await supabase
          .from("coach_session_limits")
          .update({ monthly_limit: coachLimit, peer_monthly_limit: peerLimit })
          .eq("id", coach.limit_row_id);
      } else {
        await supabase.from("coach_session_limits").insert({
          coach_user_id: coach.id,
          monthly_limit: coachLimit,
          peer_monthly_limit: peerLimit,
        });
      }

      // Reset coach-as-coachee allowlist
      await supabase
        .from("coach_as_coachee_allowlist")
        .delete()
        .eq("coach_user_id", coach.id);

      const inserts = Array.from(pickedCoachIds).map((selectable_coach_id) => ({
        coach_user_id: coach.id,
        selectable_coach_id,
      }));
      if (inserts.length) {
        const { error } = await supabase
          .from("coach_as_coachee_allowlist")
          .insert(inserts);
        if (error) throw error;
      }
      toast({ title: "Saved" });
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      toast({ title: "Save failed", description: message, variant: "destructive" });
      return false;
    } finally {
      setSaving(false);
    }
  };

  return { saving, save };
}
