import { useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Row } from "@/pages/admin/coachees/coacheeDisplay";
import { transitionAdminEnrollment } from "@/lib/enrollmentTransition";
import { resendSetupLink } from "@/lib/adminInvite";

/**
 * Owns profile edits and enrollment changes. Programme / cohort /
 * organization belong to the enrollment and change only through
 * admin_transition_enrollment: a different programme or cohort closes the
 * ongoing enrollment (history kept) and creates the new one; an
 * organization-only change corrects the current enrollment in place.
 */
export function useAdminCoacheeMutations(onChanged: () => void) {
  const { t } = useTranslation("admin");
  const [saving, setSaving] = useState(false);
  const [resendingLink, setResendingLink] = useState(false);
  const [resentLink, setResentLink] = useState<{ email: string; full_name: string; email_sent: boolean } | null>(null);

  const saveEdit = async (editing: Row, original: Row | undefined) => {
    if (!editing.spoken_languages.length) {
      toast.error(t("coacheeEditSheet.toast.spokenLanguageRequired"));
      return false;
    }
    const enrollmentChanged =
      editing.programme_id !== (original?.programme_id ?? null) ||
      editing.cohort_id !== (original?.cohort_id ?? null) ||
      editing.organization_id !== (original?.organization_id ?? null);
    // An enrollment is cohort-scoped: programme/organization alone cannot be saved.
    if (enrollmentChanged && !editing.cohort_id && (editing.programme_id || editing.organization_id || original?.enrollment_id)) {
      toast.error(t("coacheeEditSheet.toast.cohortRequired"));
      return false;
    }
    setSaving(true);
    try {
      if (enrollmentChanged && editing.cohort_id) {
        const transition = await transitionAdminEnrollment({
          userId: editing.id,
          programmeId: editing.programme_id,
          cohortId: editing.cohort_id,
          organizationId: editing.organization_id,
        });
        if (transition.action === "transitioned") toast.success(t("coacheeEditSheet.toast.enrollmentTransitioned"));
      }

      await supabase.from("profiles").update({
        full_name: editing.full_name,
        status: editing.status,
        spoken_languages: editing.spoken_languages,
      }).eq("id", editing.id);

      if (editing.limit_row_id) {
        await supabase.from("session_limits").update({ monthly_limit: editing.session_limit }).eq("id", editing.limit_row_id);
      } else {
        await supabase.from("session_limits").insert({ coachee_id: editing.id, monthly_limit: editing.session_limit });
      }

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

      toast.success(t("coacheeEditSheet.toast.coacheeUpdated"));
      onChanged();
      return true;
    } catch (e) {
      const message = e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "";
      toast.error(message || t("coacheeEditSheet.toast.saveFailed"));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const resendLoginLink = async (editing: Pick<Row, "id" | "access_request_id" | "email" | "full_name">) => {
    setResendingLink(true);
    try {
      if (!editing.access_request_id) {
        // Admin-added people have no access request: email a fresh setup link.
        const result = await resendSetupLink(editing.id);
        setResentLink({ email: result.email || editing.email, full_name: editing.full_name, email_sent: result.email_sent });
        toast.success(result.email_sent ? t("coacheeEditSheet.toast.loginLinkEmailed") : t("coacheeEditSheet.toast.emailFailedToSend"));
        return;
      }
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
      toast.success(result.email_sent ? t("coacheeEditSheet.toast.loginLinkEmailed") : t("coacheeEditSheet.toast.emailFailedToSend"));
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("coacheeEditSheet.toast.resendLinkError"));
    } finally {
      setResendingLink(false);
    }
  };

  return {
    saving,
    saveEdit,
    resendingLink,
    resendLoginLink,
    resentLink,
    setResentLink,
  };
}
