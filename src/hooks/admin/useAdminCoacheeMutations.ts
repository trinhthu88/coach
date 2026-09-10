import { useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Row } from "@/pages/admin/coachees/coacheeDisplay";
import { requestAdminEnrollment } from "@/lib/enrollmentTransition";
import type { OngoingEnrollmentConflict } from "@/lib/enrollments";

/**
 * Owns profile edits and the RPC-only enrollment request. An ongoing
 * enrollment is immutable here: switching programme, cohort, or organization
 * must first be closed explicitly in its own workflow.
 */
export function useAdminCoacheeMutations(onChanged: () => void) {
  const { t } = useTranslation("admin");
  const [saving, setSaving] = useState(false);
  const [enrollmentConflict, setEnrollmentConflict] = useState<OngoingEnrollmentConflict | null>(null);
  const [resendingLink, setResendingLink] = useState(false);
  const [resentLink, setResentLink] = useState<{ email: string; full_name: string; email_sent: boolean } | null>(null);

  const saveEdit = async (editing: Row, original: Row | undefined) => {
    if (!editing.programme_id) {
      toast.error(t("coacheeEditSheet.toast.programmeRequired"));
      return false;
    }
    if (!editing.spoken_languages.length) {
      toast.error(t("coacheeEditSheet.toast.spokenLanguageRequired"));
      return false;
    }
    setSaving(true);
    setEnrollmentConflict(null);
    try {
      const enrollmentChanged =
        !editing.enrollment_id ||
        editing.programme_id !== original?.programme_id ||
        editing.cohort_id !== original?.cohort_id ||
        editing.organization_id !== original?.organization_id;

      if (enrollmentChanged) {
        if (!editing.cohort_id || !editing.organization_id) {
          throw new Error("A cohort and sponsor organization are required for a new enrollment.");
        }
        const creation = await requestAdminEnrollment({
          userId: editing.id,
          programmeId: editing.programme_id,
          cohortId: editing.cohort_id,
          organizationId: editing.organization_id,
        });
        if (creation.kind === "conflict") {
          setEnrollmentConflict(creation.conflict);
          return false;
        }
        if (creation.kind === "error") throw creation.error;
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
      toast.error(e instanceof Error ? e.message : t("coacheeEditSheet.toast.saveFailed"));
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
    enrollmentConflict,
    clearEnrollmentConflict: () => setEnrollmentConflict(null),
    resendingLink,
    resendLoginLink,
    resentLink,
    setResentLink,
  };
}
