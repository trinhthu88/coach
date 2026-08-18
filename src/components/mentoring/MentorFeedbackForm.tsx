import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Save } from "lucide-react";
import { getFriendlyErrorMessage } from "@/lib/errors";
import { toast } from "sonner";
import { COMPETENCY_KEYS, MentoringFeedbackState } from "@/hooks/mentoring/types";
import type { useMentoringFeedback } from "@/hooks/mentoring/useMentoringFeedback";

interface Props {
  feedback: ReturnType<typeof useMentoringFeedback>;
  isMentor: boolean;
  /** Only true once the mentor may submit — after the session is completed. */
  canSubmit: boolean;
}

/**
 * Mentoring's equivalent of PeerCompetencyFeedback (SessionDetail.tsx) — the
 * same 8 ICF competency categories, but a Textarea per competency instead of
 * a 0-100 range slider, since mentor feedback here is a written form, not a
 * rating (see mentoring_feedback's text columns).
 */
export function MentorFeedbackForm({ feedback, isMentor, canSubmit }: Props) {
  const { t } = useTranslation("mentoring");
  // Seeded once from the loaded feedback, then locally editable — same
  // pattern as PeerCompetencyFeedback (SessionDetail.tsx): a successful save
  // updates `existed` locally rather than resyncing from a refetch.
  const [state, setState] = useState<MentoringFeedbackState>(feedback.feedback);
  const [saving, setSaving] = useState(false);

  const setValue = (key: (typeof COMPETENCY_KEYS)[number], v: string) => setState((p) => ({ ...p, [key]: v }));

  const save = async () => {
    setSaving(true);
    const { error } = await feedback.save(state);
    setSaving(false);
    if (error) {
      if ((error as { code?: string }).code === "P0001") {
        toast.error(t("sessionDetail.prepFileRequiredToComplete"));
        return;
      }
      toast.error(getFriendlyErrorMessage(error, t));
      return;
    }
    setState((p) => ({ ...p, existed: true }));
    toast.success(t("sessionDetail.feedbackSaved"));
  };

  if (!isMentor) {
    if (!feedback.feedback.existed) {
      return (
        <Card className="space-y-2 p-5 sm:p-8">
          <p className="eyebrow text-primary">{t("sessionDetail.feedbackSection")}</p>
          <p className="text-sm text-muted-foreground">{t("sessionDetail.feedbackNotAvailable")}</p>
        </Card>
      );
    }
    return (
      <Card className="space-y-5 p-5 sm:p-8">
        <div>
          <p className="eyebrow text-primary">{t("sessionDetail.feedbackSection")}</p>
          <p className="mt-2 text-sm text-muted-foreground">{t("sessionDetail.feedbackReadonlyIntro")}</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {COMPETENCY_KEYS.map((key) => (
            <div key={key} className="space-y-1.5">
              <p className="text-sm font-medium">{t(`sessionDetail.competencies.${key}`)}</p>
              <p className="rounded-lg border bg-muted/20 p-2.5 text-sm text-muted-foreground">
                {feedback.feedback[key] || "—"}
              </p>
            </div>
          ))}
        </div>
        <div>
          <p className="eyebrow mb-2 text-primary">{t("sessionDetail.overallNotes")}</p>
          <p className="rounded-lg border bg-muted/20 p-2.5 text-sm text-muted-foreground">
            {feedback.feedback.overall_notes || "—"}
          </p>
        </div>
      </Card>
    );
  }

  if (!canSubmit) {
    return (
      <Card className="space-y-2 p-5 sm:p-8">
        <p className="eyebrow text-primary">{t("sessionDetail.feedbackSection")}</p>
        <p className="text-sm text-muted-foreground">{t("sessionDetail.feedbackNotReady")}</p>
      </Card>
    );
  }

  return (
    <Card className="space-y-5 p-5 sm:p-8">
      <div>
        <p className="eyebrow text-primary">{t("sessionDetail.feedbackSection")}</p>
        <p className="mt-2 text-sm text-muted-foreground">{t("sessionDetail.feedbackIntro")}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {COMPETENCY_KEYS.map((key) => (
          <div key={key} className="space-y-1.5">
            <p className="text-sm font-medium">{t(`sessionDetail.competencies.${key}`)}</p>
            <Textarea rows={3} value={state[key]} onChange={(e) => setValue(key, e.target.value)} />
          </div>
        ))}
      </div>
      <div>
        <p className="eyebrow mb-2 text-primary">{t("sessionDetail.overallNotes")}</p>
        <Textarea
          rows={4}
          value={state.overall_notes}
          onChange={(e) => setState((p) => ({ ...p, overall_notes: e.target.value }))}
        />
      </div>
      <div className="flex justify-end">
        <Button className="rounded-full" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
          {state.existed ? t("sessionDetail.updateFeedback") : t("sessionDetail.saveFeedback")}
        </Button>
      </div>
    </Card>
  );
}
