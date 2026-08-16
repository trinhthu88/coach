import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Row } from "@/pages/admin/coachees/coacheeDisplay";

/**
 * Owns the two write actions available from the coachee edit drawer: saving
 * the full edit form, and resending the passwordless login link.
 */
export function useAdminCoacheeMutations(onChanged: () => void) {
  const [saving, setSaving] = useState(false);
  const [resendingLink, setResendingLink] = useState(false);
  const [resentLink, setResentLink] = useState<{ email: string; full_name: string; email_sent: boolean } | null>(null);

  const saveEdit = async (editing: Row, original: Row | undefined) => {
    if (!editing.programme_id) {
      toast.error("Programme is required");
      return;
    }
    setSaving(true);
    try {
      await supabase.from("profiles").update({
        full_name: editing.full_name,
        status: editing.status,
      }).eq("id", editing.id);

      // session limit override
      if (editing.limit_row_id) {
        await supabase.from("session_limits").update({ monthly_limit: editing.session_limit }).eq("id", editing.limit_row_id);
      } else {
        await supabase.from("session_limits").insert({ coachee_id: editing.id, monthly_limit: editing.session_limit });
      }

      // Selected coaches diff
      const oldIds = new Set((original?.selected_coaches || []).map((c) => c.id));
      const newIds = new Set(editing.selected_coaches.map((c) => c.id));
      const toAdd = [...newIds].filter((i) => !oldIds.has(i));
      const toRemove = [...oldIds].filter((i) => !newIds.has(i));
      if (toAdd.length) {
        await supabase.from("coachee_coach_allowlist").insert(
          toAdd.map((cid) => ({ coachee_id: editing.id, coach_id: cid, source: "admin_added" }))
        );
      }
      for (const cid of toRemove) {
        await supabase.from("coachee_coach_allowlist").delete().eq("coachee_id", editing.id).eq("coach_id", cid);
      }

      // Programme/cohort/organization
      if (editing.programme_id) {
        if (editing.enrollment_id) {
          await supabase.from("programme_enrollments").update({
            programme_id: editing.programme_id,
            cohort_id: editing.cohort_id,
            organization_id: editing.organization_id,
          }).eq("id", editing.enrollment_id);
        } else {
          await supabase.from("programme_enrollments").insert({
            coachee_id: editing.id,
            programme_id: editing.programme_id,
            cohort_id: editing.cohort_id,
            organization_id: editing.organization_id,
          });
        }
      } else if (editing.enrollment_id) {
        await supabase.from("programme_enrollments").delete().eq("id", editing.enrollment_id);
      }

      toast.success("Coachee updated");
      onChanged();
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const resendLoginLink = async (editing: Pick<Row, "access_request_id" | "email" | "full_name">) => {
    if (!editing.access_request_id) return;
    setResendingLink(true);
    try {
      const { data, error } = await supabase.functions.invoke("approve-access-request", {
        body: { request_id: editing.access_request_id, resend_magic_link: true },
      });
      if (error) throw error;
      const result = data as { error?: string; email?: string; email_sent?: boolean };
      if (result?.error) throw new Error(result.error);

      setResentLink({
        email: result.email ?? editing.email,
        full_name: editing.full_name,
        email_sent: !!result.email_sent,
      });
      toast.success(result.email_sent ? "Login link emailed" : "Email failed to send");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not resend login link");
    } finally {
      setResendingLink(false);
    }
  };

  return { saving, saveEdit, resendingLink, resendLoginLink, resentLink, setResentLink };
}
