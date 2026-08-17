import { useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { toast } from "@/hooks/use-toast";
import { getFriendlyErrorMessage } from "@/lib/errors";
import { Status } from "./types";

type CoachProfileUpdate = Database["public"]["Tables"]["coach_profiles"]["Update"];

const STATUS_LABEL: Record<Status, string> = {
  pending_approval: "Awaiting approval",
  active: "Active",
  rejected: "Rejected",
  suspended: "Suspended",
  reach_limit: "Reached limit",
};

/**
 * Mutations for approving/rejecting/suspending coachees and coaches from the
 * admin registrations page.
 */
export function useAdminRegistrationApprovals(onDone: () => Promise<void> | void) {
  const { t } = useTranslation("common");
  const [busyId, setBusyId] = useState<string | null>(null);

  const setCoacheeStatusValue = async (id: string, status: Status) => {
    setBusyId(id);
    const { error } = await supabase.from("profiles").update({ status }).eq("id", id);
    if (error) toast({ title: t("actions.failed"), description: getFriendlyErrorMessage(error, t), variant: "destructive" });
    else {
      toast({ title: `Coachee ${STATUS_LABEL[status].toLowerCase()}` });
      await onDone();
    }
    setBusyId(null);
  };

  const setCoachStatusValue = async (id: string, status: Status) => {
    setBusyId(id);
    const patch: CoachProfileUpdate = { approval_status: status };
    if (status === "active") patch.last_approved_at = new Date().toISOString();
    const { error: cErr } = await supabase
      .from("coach_profiles")
      .update(patch)
      .eq("id", id);
    if (!cErr) {
      await supabase.from("profiles").update({ status }).eq("id", id);
      toast({ title: `Coach ${STATUS_LABEL[status].toLowerCase()}` });
      await onDone();
    } else {
      toast({ title: t("actions.failed"), description: getFriendlyErrorMessage(cErr, t), variant: "destructive" });
    }
    setBusyId(null);
  };

  return { busyId, setCoacheeStatusValue, setCoachStatusValue };
}
