import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

/**
 * Saves a coachee's monthly session limit and its allowlist of bookable coaches.
 */
export function useUpdateCoacheeAssignment() {
  const [saving, setSaving] = useState(false);

  const save = async (coacheeId: string, limit: number, pickedCoachIds: Set<string>) => {
    setSaving(true);
    try {
      // Save monthly limit
      await supabase
        .from("session_limits")
        .upsert(
          { coachee_id: coacheeId, monthly_limit: limit },
          { onConflict: "coachee_id" }
        );

      // Reset allowlist
      await supabase
        .from("coachee_coach_allowlist")
        .delete()
        .eq("coachee_id", coacheeId);

      const inserts = Array.from(pickedCoachIds).map((coach_id) => ({
        coachee_id: coacheeId,
        coach_id,
        source: "admin_added",
      }));
      if (inserts.length) {
        const { error } = await supabase
          .from("coachee_coach_allowlist")
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
