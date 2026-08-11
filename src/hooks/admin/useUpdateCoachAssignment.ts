import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

/**
 * Saves a coach's coach-as-coachee allowlist of assignable coaches. Session limits
 * are managed separately via coach_programme_enrollments (see the Coach Programmes
 * admin page), not here.
 */
export function useUpdateCoachAssignment() {
  const [saving, setSaving] = useState(false);

  const save = async (coach: { id: string }, pickedCoachIds: Set<string>) => {
    setSaving(true);
    try {
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
